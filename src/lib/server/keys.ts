/**
 * LibrePay key material — BIP39 mnemonic + BIP32 derivation + payment codes.
 *
 * ISOMORPHIC: safe on client (browser) and server. Note that the SERVER only
 * ever handles PUBLIC keys — mnemonic/seed/private keys are only used in the
 * browser (and in the test-suite).
 *
 * Payment code (BIP47-style, LibrePay v1, 72 bytes, Base58Check):
 *   [0]      version   = 0x01
 *   [1]      sign      = 0x00 (BIP47 layout compat)
 *   [2..5]   zero      = 0x00000000 (BIP47 padding compat)
 *   [6..38]  scanPub   = 33-byte compressed secp256k1 public key (ECDH scan key)
 *   [39..71] spendPub  = 33-byte compressed secp256k1 public key (spend key)
 *
 * Unlike BIP47's on-chain notification transaction, the buyer-side ephemeral
 * pubkey is carried by the invoice (off-chain) — cheaper and still unlinkable
 * on-chain: every invoice gets a unique one-time stealth address.
 */

import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic, generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { createBase58check, bech32 as bech32Base } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";

const b58c = createBase58check(sha256);

/** Derivation paths (mainnet) */
export const SCAN_PATH = "m/47'/0'/0'/0"; // ECDH scan key (leaf)
export const SPEND_PATH = "m/47'/0'/0'/1"; // stealth spend key (leaf)
export const ACCOUNT_PATH = "m/84'/0'/0'"; // BIP84 account for watch-only xpub

const ZPUB_VERSION = new Uint8Array([0x04, 0xb2, 0x47, 0x46]);
const XPUB_VERSION = new Uint8Array([0x04, 0x88, 0xb2, 0x1e]);
const WIF_VERSION = 0x80;

export interface WalletKeys {
  scanPriv: Uint8Array;
  scanPub: Uint8Array; // 33B compressed
  spendPriv: Uint8Array;
  spendPub: Uint8Array; // 33B compressed
  /** BIP84 account-level zpub (watch-only export) */
  accountZpub: string;
  /** Base58Check payment code */
  paymentCode: string;
}

export function newMnemonic(words: 12 | 24 = 12): string {
  return generateMnemonic(wordlist, words === 24 ? 256 : 128);
}

export function isValidMnemonic(mnemonic: string): boolean {
  try {
    return validateMnemonic(mnemonic.trim().replace(/\s+/g, " ").toLowerCase(), wordlist);
  } catch {
    return false;
  }
}

export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
}

export function seedFromMnemonic(mnemonic: string, passphrase = ""): Uint8Array {
  if (!isValidMnemonic(mnemonic)) throw new Error("Invalid mnemonic phrase");
  return mnemonicToSeedSync(normalizeMnemonic(mnemonic), passphrase);
}

export function deriveWalletKeys(seed: Uint8Array): WalletKeys {
  const root = HDKey.fromMasterSeed(seed);
  const scan = root.derive(SCAN_PATH);
  const spend = root.derive(SPEND_PATH);
  const acct = root.derive(ACCOUNT_PATH);
  if (!scan.privateKey || !scan.publicKey || !spend.privateKey || !spend.publicKey || !acct.publicKey) {
    throw new Error("Derivation failed");
  }

  return {
    scanPriv: scan.privateKey,
    scanPub: secpCompress(scan.publicKey),
    spendPriv: spend.privateKey,
    spendPub: secpCompress(spend.publicKey),
    accountZpub: toZpub(acct.publicExtendedKey),
    paymentCode: buildPaymentCode(secpCompress(spend.publicKey), secpCompress(scan.publicKey)),
  };
}

/** HDKey.publicKey from @scure/bip32 is already 33-byte compressed; ensure it */
function secpCompress(pub: Uint8Array): Uint8Array {
  if (pub.length === 33) return pub;
  if (pub.length === 65) return new Uint8Array([0x02 + (pub[64] & 1), ...pub.slice(1, 33)]);
  throw new Error("Unexpected public key length");
}

export function buildPaymentCode(spendPub: Uint8Array, scanPub: Uint8Array): string {
  if (spendPub.length !== 33 || scanPub.length !== 33) throw new Error("Public keys must be 33-byte compressed");
  const buf = new Uint8Array(72);
  buf[0] = 0x01; // version
  buf[1] = 0x00; // sign
  // [2..5] zero padding
  buf.set(scanPub, 6);
  buf.set(spendPub, 39);
  // [70..71] reserved
  return b58c.encode(buf);
}

export interface ParsedPaymentCode {
  version: number;
  scanPub: Uint8Array;
  spendPub: Uint8Array;
}

export function parsePaymentCode(code: string): ParsedPaymentCode {
  const buf = b58c.decode(code.trim());
  if (buf.length !== 72) throw new Error("Invalid payment code length");
  if (buf[0] !== 0x01) throw new Error("Unsupported payment code version");
  return {
    version: buf[0],
    scanPub: buf.slice(6, 39),
    spendPub: buf.slice(39, 72),
  };
}

/** Convert xpub string to zpub (BIP84) by swapping the version prefix. */
export function toZpub(xpub: string): string {
  const raw = b58c.decode(xpub.trim());
  if (raw.length !== 78) throw new Error("Invalid extended key");
  const out = new Uint8Array(78);
  out.set(ZPUB_VERSION, 0);
  out.set(raw.slice(4), 4);
  return b58c.encode(out);
}

/** Accept xpub or zpub; returns normalized zpub + its 33-byte account pubkey. */
export function normalizeXpub(input: string): { zpub: string; accountPub: Uint8Array } {
  const raw = b58c.decode(input.trim());
  if (raw.length !== 78) throw new Error("Invalid extended key length");
  const version = raw.slice(0, 4);
  const isX = version.every((b, i) => b === XPUB_VERSION[i]);
  const isZ = version.every((b, i) => b === ZPUB_VERSION[i]);
  if (!isX && !isZ) throw new Error("Only mainnet xpub/zpub are supported");
  const zpub = isZ ? b58c.encode(raw) : toZpub(input.trim());
  // pubkey lives at index 45..78 (33 bytes compressed)
  return { zpub, accountPub: raw.slice(45, 78) };
}

/** WIF export (compressed) for a 32-byte private key. */
export function toWIF(priv: Uint8Array): string {
  const buf = new Uint8Array(34);
  buf[0] = WIF_VERSION;
  buf.set(priv, 1);
  buf[33] = 0x01; // compressed flag
  return b58c.encode(buf);
}

/** P2WPKH bech32 address from a 33-byte compressed pubkey. */
export function pubkeyToBech32Address(pub33: Uint8Array, hrp = "bc"): string {
  const h160 = ripemd160(sha256(pub33));
  // segwit encoding: [witness_version=0, ...program_words]
  return bech32Base.encode(hrp, [0, ...bech32Base.toWords(h160)]).toString();
}

export { b58c };
