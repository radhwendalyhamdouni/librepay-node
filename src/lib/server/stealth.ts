/**
 * Stealth address derivation (BIP47-style, off-chain notification variant).
 *
 * ISOMORPHIC — pure crypto on public data. Two complementary primitives:
 *
 * 1) deriveStealthAddress(scanPub, spendPub)          [SERVER, public inputs]
 *    Server generates ephemeral key e; shared = ECDH(e, scanPub);
 *    s = sha256(shared); stealthPub = spendPub + s·G;
 *    address = bech32(hash160(stealthPub)).
 *    The ephemeral PRIVATE key is discarded — the server can never spend.
 *
 * 2) computeStealthSecretKey(scanPriv, spendPriv, ephPub)  [CLIENT, secrets]
 *    Merchant wallet recomputes s = sha256(ECDH(scanPriv, ephPub)) and derives
 *    childPriv = spendPriv + s (mod n) — the key that controls the funds.
 *
 * On-chain, each invoice address is a fresh, unlinkable key. Chain observers
 * cannot correlate invoices to the same merchant.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { bech32 } from "@scure/base";
import { parsePaymentCode, pubkeyToBech32Address } from "./keys";

const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export interface StealthResult {
  /** P2WPKH one-time address (bc1q…) */
  address: string;
  /** 33-byte compressed ephemeral public key (hex) — stored on the invoice */
  ephemeralPub: string;
}

/** SERVER-SIDE (public data only). Generates a fresh one-time address. */
export function deriveStealthAddress(scanPub: Uint8Array, spendPub: Uint8Array): StealthResult {
  const ephSecret = secp256k1.utils.randomSecretKey();
  const ephPub = secp256k1.getPublicKey(ephSecret, true);
  const s = sha256(secp256k1.getSharedSecret(ephSecret, scanPub));
  const stealthPub = secp256k1.Point.fromBytes(spendPub)
    .add(secp256k1.Point.fromBytes(secp256k1.getPublicKey(s, true))) // s·G
    .toBytes(true);
  return {
    address: pubkeyToBech32Address(stealthPub),
    ephemeralPub: bytesToHex(ephPub),
  };
}

/** Derive a one-time address from a serialized payment code. */
export function stealthAddressFromPaymentCode(paymentCode: string): StealthResult {
  const { scanPub, spendPub } = parsePaymentCode(paymentCode);
  return deriveStealthAddress(scanPub, spendPub);
}

/** CLIENT-SIDE (needs secrets). Recompute the spendable key for an invoice. */
export function computeStealthSecretKey(
  scanPriv: Uint8Array,
  spendPriv: Uint8Array,
  ephPubHex: string
): Uint8Array {
  const ephPub = hexToBytes(ephPubHex);
  const s = sha256(secp256k1.getSharedSecret(scanPriv, ephPub));
  const spend = BigInt("0x" + bytesToHex(spendPriv));
  const add = BigInt("0x" + bytesToHex(s));
  const child = ((spend + add) % SECP_N).toString(16).padStart(64, "0");
  return hexToBytes(child);
}

/** hash160 = ripemd160(sha256(x)) */
export function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

export function bech32Encode20(hrp: string, h160: Uint8Array): string {
  return bech32.encode(hrp, [0, ...bech32.toWords(h160)]).toString();
}

// ---------- small hex/bytes helpers (no deps) ----------
export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function hexToBytes(h: string): Uint8Array {
  const s = h.trim().toLowerCase().replace(/^0x/, "");
  if (s.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
