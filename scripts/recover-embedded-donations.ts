/**
 * recover-embedded-donations.ts — sweep donations received by the EMBEDDED
 * stealth engine (librepay.tech running LibrePay's BIP47 math on Vercel,
 * no node server, no database).
 *
 * The embedded engine derives each donation address from:
 *   ephSecret = HMAC-SHA256(secretMaterial, "librepay-eph:" + ts) mod n
 *   shared    = ECDH(ephSecret, scanPub)          (node's stealth.ts math)
 *   s         = sha256(shared)
 *   address   = P2WPKH( spendPub + pubkey(s) )
 * with secretMaterial = "lp-eph:" + LP_DONATION_SECRET  (or, before the
 * secret was set, "lp-eph:fallback:" + the payment code).
 *
 * ECDH is symmetric, so YOU (the maintainer, holding the wallet that owns
 * the payment code) can re-derive every address ever issued from
 * (mnemonic, secret, time range) alone and reconstruct the spendable key
 * per address — exactly what this script automates:
 *   childPriv = spendPriv + sha256(ECDH(scanPriv, ephPub))  (mod n)
 *
 * Usage:
 *   bun scripts/recover-embedded-donations.ts \
 *     --mnemonic "twelve-or-twenty-four words" [--passphrase "…"] \
 *     --secret  <LP_DONATION_SECRET value> \
 *     --from    2026-09-30 [--to 2026-12-31] \
 *     [--code PM8T…]  [--esplora https://mempool.space/api]  [--json]
 *
 *   · --secret omitted → falls back to the payment-code material
 *     (matches the engine's behaviour before LP_DONATION_SECRET existed)
 *   · dates are UTC; scan time ≈ seconds in range ÷ your rate limit
 *   · output: one row per funded address with its WIF — import the WIF
 *     into any wallet (or your own /cold flow) and sweep.
 *
 * NOTHING here can spend by itself: the script only reconstructs keys for
 * addresses that actually received funds, on YOUR machine, from YOUR
 * secrets. Never share your mnemonic or the output.
 */

import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  deriveWalletKeys,
  toWIF,
} from "../src/lib/server/keys";
import {
  hash160,
  bech32Encode20,
  computeStealthSecretKey,
} from "../src/lib/server/stealth";

const SECP_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// ─────────────────────────── CLI ────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mnemonic = arg("mnemonic");
const passphrase = arg("passphrase") ?? "";
const secret = arg("secret");
const codeArg = arg("code");
const esplora = arg("esplora") ?? "https://mempool.space/api";
const fromStr = arg("from");
const toStr = arg("to");
const asJson = process.argv.includes("--json");

if (!mnemonic || !fromStr) {
  console.error(
    "Usage: bun scripts/recover-embedded-donations.ts --mnemonic \"…\" --secret <LP_DONATION_SECRET> --from 2026-09-30 [--to 2026-12-31] [--code PM8T…] [--esplora URL] [--json]\n" +
      "If LP_DONATION_SECRET was never set on Vercel, omit --secret and pass --code PM8T… instead."
  );
  process.exit(1);
}

const words = mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
if (!validateMnemonic(words, wordlist)) {
  console.error("Invalid mnemonic phrase.");
  process.exit(1);
}

const fromSec = Math.floor(Date.parse(`${fromStr}T00:00:00Z`) / 1000);
const toSec = toStr
  ? Math.floor(Date.parse(`${toStr}T23:59:59Z`) / 1000)
  : Math.floor(Date.now() / 1000);
if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || toSec <= fromSec) {
  console.error("Invalid --from/--to range (dates are UTC, e.g. 2026-09-30).");
  process.exit(1);
}

// ───────────────────── wallet + engine parity ───────────────────────────

const seed = mnemonicToSeedSync(words, passphrase);
const keys = deriveWalletKeys(seed, "mainnet");

// secretMaterial must match the platform's ephemeralSecretBytes() exactly.
const secretMaterial = secret
  ? `lp-eph:${secret}`
  : `lp-eph:fallback:${codeArg ?? keys.paymentCode}`;
const secretBytes = new TextEncoder().encode(secretMaterial);

if (codeArg && codeArg.trim() !== keys.paymentCode) {
  console.error(
    "The --code you passed does NOT match the wallet's own payment code —\n" +
      "this mnemonic does not control that payment code. Aborting."
  );
  process.exit(1);
}

/** Same scalar derivation as the platform's embeddedEphemeralScalar(). */
function ephScalar(ts: number): Uint8Array {
  const h = hmac(sha256, secretBytes, new TextEncoder().encode(`librepay-eph:${ts}`));
  let x = BigInt("0x" + Buffer.from(h).toString("hex")) % SECP_N;
  if (x === 0n) x = 1n;
  return Buffer.from(x.toString(16).padStart(64, "0"), "hex");
}

/** Same address math as the node's deriveStealthAddress(), deterministic eph. */
function addressFor(ts: number): { address: string; ephPub: string } {
  const e = ephScalar(ts);
  const ephPub = secp256k1.getPublicKey(e, true);
  const s = sha256(secp256k1.getSharedSecret(e, keys.scanPub));
  const stealthPub = secp256k1.Point.fromBytes(keys.spendPub)
    .add(secp256k1.Point.fromBytes(secp256k1.getPublicKey(s, true)))
    .toBytes(true);
  return {
    address: bech32Encode20("bc", hash160(stealthPub)),
    ephPub: Buffer.from(ephPub).toString("hex"),
  };
}

// ─────────────────────────── scan ───────────────────────────────────────

interface Hit {
  ts: number;
  iso: string;
  address: string;
  ephPub: string;
  fundedSats: number;
  spentSats: number;
  wif: string;
}
const hits: Hit[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const total = toSec - fromSec + 1;
const started = Date.now();

process.stdout.write(
  `Scanning ${total.toLocaleString("en")} seconds (${fromStr} → ${toStr || "now"}) on ${esplora}\n` +
    `Payment code: ${keys.paymentCode}\n\n`
);

for (let ts = fromSec, done = 0; ts <= toSec; ts++, done++) {
  const { address, ephPub } = addressFor(ts);
  try {
    const res = await fetch(`${esplora}/address/${address}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const st = (await res.json()) as {
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
        mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
      };
      const funded =
        st.chain_stats.funded_txo_sum + st.mempool_stats.funded_txo_sum;
      const spent = st.chain_stats.spent_txo_sum + st.mempool_stats.spent_txo_sum;
      if (funded > 0) {
        const child = computeStealthSecretKey(keys.scanPriv, keys.spendPriv, ephPub);
        const hit: Hit = {
          ts,
          iso: new Date(ts * 1000).toISOString(),
          address,
          ephPub,
          fundedSats: funded,
          spentSats: spent,
          wif: toWIF(child, "mainnet"),
        };
        hits.push(hit);
        if (!asJson) {
          console.log(
            `● ${hit.iso}  ${address}  received ${funded.toLocaleString("en")} sats` +
              (spent > 0 ? ` (swept ${spent.toLocaleString("en")})` : "") +
              `\n  WIF: ${hit.wif}`
          );
        }
      }
    }
  } catch {
    // network hiccup — skip this second, keep scanning
  }
  if (done % 50 === 49) await sleep(1_100); // stay polite with public APIs
  if (done % 1_000 === 999) {
    const pct = ((done / total) * 100).toFixed(1);
    const elapsed = Math.round((Date.now() - started) / 1000);
    process.stdout.write(`  … ${pct}% (${done.toLocaleString("en")} checked, ${elapsed}s)\n`);
  }
}

if (asJson) {
  console.log(JSON.stringify({ paymentCode: keys.paymentCode, hits }, null, 2));
} else {
  console.log(
    `\nDone. ${hits.length} funded address(es) found. ` +
      (hits.length
        ? "Import each WIF into a wallet and sweep to your own address. Keep this output private."
        : "No funds found in this range — check --from/--to and --secret.")
  );
}
