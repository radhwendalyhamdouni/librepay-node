/**
 * Server-side invoice address derivation — PUBLIC DATA ONLY.
 * Either from a BIP47-style payment code (stealth) or a watch-only zpub.
 * No private key material is ever accepted or stored here.
 */

import { HDKey } from "@scure/bip32";
import { parsePaymentCode, pubkeyToBech32Address } from "./keys";
import { deriveStealthAddress, hash160, bech32Encode20, bytesToHex } from "./stealth";

export interface DerivedAddress {
  mode: "stealth" | "watchonly";
  address: string;
  /** hex ephemeral pubkey (stealth only) */
  ephemeralPub?: string;
  /** derivation index (watchonly only) */
  index?: number;
}

export function deriveInvoiceAddress(paymentCode: string): DerivedAddress {
  const { scanPub, spendPub } = parsePaymentCode(paymentCode);
  const r = deriveStealthAddress(scanPub, spendPub);
  return { mode: "stealth", address: r.address, ephemeralPub: r.ephemeralPub };
}

const ZPUB_VERSIONS = { private: 0x04b2430c, public: 0x04b24746 };
const XPUB_VERSIONS = { private: 0x0488ade4, public: 0x0488b21e };

export function deriveWatchOnlyAddress(extendedKey: string, index: number): DerivedAddress {
  const versions = extendedKey.trim().startsWith("zpub") ? ZPUB_VERSIONS : XPUB_VERSIONS;
  const hd = HDKey.fromExtendedKey(extendedKey.trim(), versions);
  const child = hd.derive(`m/0/${index}`);
  if (!child.publicKey) throw new Error("xpub derivation failed");
  return { mode: "watchonly", address: pubkeyToBech32Address(child.publicKey), index };
}

export { hash160, bech32Encode20, bytesToHex };
