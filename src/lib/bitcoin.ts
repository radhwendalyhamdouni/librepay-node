/**
 * Bitcoin display helpers + BIP21 URIs + fiat estimates (isomorphic).
 */

import { bech32, bech32m, base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";

const b58c = base58check(sha256);

export const SATS_PER_BTC = 100_000_000;

export function formatSats(sats: bigint | number | string): string {
  const n = typeof sats === "bigint" ? Number(sats) : typeof sats === "string" ? parseInt(sats) : sats;
  return n.toLocaleString("en-US");
}

export function satsToBtc(sats: bigint | number | string): string {
  const n = typeof sats === "bigint" ? Number(sats) : typeof sats === "string" ? parseInt(sats) : sats;
  return (n / SATS_PER_BTC).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

/** BIP21 payment URI: bitcoin:<addr>?amount=<btc>&label=&message= */
export function bip21Uri(address: string, sats: bigint | number | string, label?: string, message?: string): string {
  const params = new URLSearchParams();
  const btc = satsToBtc(sats);
  if (btc) params.set("amount", btc);
  if (label) params.set("label", label.slice(0, 64));
  if (message) params.set("message", message.slice(0, 96));
  const qs = params.toString();
  return `bitcoin:${address}${qs ? `?${qs}` : ""}`;
}

export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "CHF", "CAD", "AUD", "JPY",
  "AED", "SAR", "TND", "DZD", "MAD", "EGP", "TRY",
] as const;

export function formatFiat(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** sats per fiat unit → sats amount */
export function fiatToSats(fiat: number, fiatPerBtc: number): number {
  if (!fiatPerBtc || fiatPerBtc <= 0) throw new Error("bad rate");
  return Math.max(1, Math.round((fiat / fiatPerBtc) * SATS_PER_BTC));
}

/**
 * LibrePay pricing rule — USD-anchored, sats computed live:
 *   sats = (USD ÷ BTC_USD) × 100,000,000
 * Displayed price is fixed in USD; sats are computed at display time and
 * LOCKED the moment an invoice/subscription is created (rate snapshot kept
 * for audit). Example at BTC=$100k: $1 = 1,000 sats.
 */
export function usdToSats(usd: number, usdPerBtc: number): number {
  if (!usdPerBtc || usdPerBtc <= 0) throw new Error("bad rate");
  return Math.max(1, Math.round((usd / usdPerBtc) * SATS_PER_BTC));
}

/**
 * Underpayment tolerance — L1 wallet fee rounding shouldn't fail an order.
 * A payment covering all but ≤ UNDERPAYMENT_TOLERANCE_PCT of the invoice
 * total is treated as fully paid (state flows to confirmed/settled);
 * anything shorter is flagged `underpaid` as before. Default 1%.
 */
export const UNDERPAYMENT_TOLERANCE_PCT = 1;

export function isWithinUnderpaymentTolerance(
  totalSats: bigint,
  amountSats: bigint,
  tolerancePct: number = UNDERPAYMENT_TOLERANCE_PCT
): boolean {
  if (totalSats >= amountSats) return true;
  if (tolerancePct <= 0) return false;
  const shortfall = amountSats - totalSats;
  return shortfall * 100n <= amountSats * BigInt(Math.floor(tolerancePct));
}

/**
 * Strict BTC address validation WITH checksum verification, per network.
 *  - mainnet: bc1… (SegWit v0 P2WPKH/P2WSH bech32, v1+ P2TR bech32m) per
 *    BIP-173/350 · 1…/3… (P2PKH/P2SH base58check)
 *  - testnet: tb1… · m…/n…/2… (same encodings, testnet versions)
 * A typo'd refund address now fails instead of burning the merchant's funds.
 */
export function isValidBtcAddress(address: string, network: "mainnet" | "testnet" = "mainnet"): boolean {
  const addr = (address || "").trim();
  if (!addr) return false;
  const bech32Re = network === "testnet" ? /^tb1/i : /^bc1/i;

  // --- SegWit: bech32 / bech32m ---
  const mixedCase = addr !== addr.toLowerCase() && addr !== addr.toUpperCase();
  if (!mixedCase && bech32Re.test(addr)) {
    try {
      const s = addr.toLowerCase();
      let ver = -1;
      let program: number[] = [];
      let viaBech32m = false;
      try {
        const d = bech32.decode(s, 90);
        ver = d.words[0];
        program = Array.from(bech32.fromWords(d.words.slice(1)));
      } catch {
        const d = bech32m.decode(s, 90);
        ver = d.words[0];
        program = Array.from(bech32m.fromWords(d.words.slice(1)));
        viaBech32m = true;
      }
      if (ver < 0 || ver > 16) return false;
      if (ver === 0) {
        // v0: bech32 ONLY (lowercase OR uppercase — mixed already rejected), program 20 or 32 bytes
        return !viaBech32m && (program.length === 20 || program.length === 32);
      }
      // v1..16: bech32m ONLY, program 2–40 bytes
      return viaBech32m && program.length >= 2 && program.length <= 40;
    } catch {
      return false;
    }
  }

  // --- Legacy: base58check (P2PKH/P2SH) ---
  if (network === "testnet") {
    if (/^[mn2][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) {
      try {
        const bytes = b58c.decode(addr);
        return bytes.length === 21; // version(1) + hash160(20) — checksum verified & stripped by base58check
      } catch {
        return false;
      }
    }
    return false;
  }
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) {
    try {
      const bytes = b58c.decode(addr);
      return bytes.length === 21; // version(1) + hash160(20) — checksum verified & stripped by base58check
    } catch {
      return false;
    }
  }
  return false;
}
