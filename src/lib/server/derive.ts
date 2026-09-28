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

export function deriveInvoiceAddress(paymentCode: string, hrp = "bc"): DerivedAddress {
  const { scanPub, spendPub } = parsePaymentCode(paymentCode);
  const r = deriveStealthAddress(scanPub, spendPub, hrp);
  return { mode: "stealth", address: r.address, ephemeralPub: r.ephemeralPub };
}

const ZPUB_VERSIONS = { private: 0x04b2430c, public: 0x04b24746 };
const XPUB_VERSIONS = { private: 0x0488ade4, public: 0x0488b21e };
const VPUB_VERSIONS = { private: 0x045f18bc, public: 0x045f1cf6 };
const TPUB_VERSIONS = { private: 0x04358394, public: 0x043587cf };

/** Mainnet-prefixed keys must never feed a tb-hrped node, and vice versa —
 *  a silent mismatch would generate valid-looking addresses that can NEVER
 *  receive the funds the invoice promised. Fail loudly instead. */
function extendedKeyVersions(key: string, hrp: string) {
  const k = key.trim();
  const mainnet = k.startsWith("zpub") || k.startsWith("xpub") || k.startsWith("ypub");
  const testnet = k.startsWith("vpub") || k.startsWith("tpub") || k.startsWith("upub");
  if (mainnet && hrp === "tb") {
    throw new Error("mainnet key on a testnet node — set LP_NETWORK=mainnet or use a vpub from your testnet wallet");
  }
  if (testnet && hrp === "bc") {
    throw new Error("testnet key on a mainnet node — set LP_NETWORK=testnet or use a zpub from your mainnet wallet");
  }
  if (k.startsWith("vpub")) return VPUB_VERSIONS;
  if (k.startsWith("tpub")) return TPUB_VERSIONS;
  if (k.startsWith("upub")) throw new Error("upub (P2SH-P2WPKH) is not supported — use a vpub (native segwit)");
  if (k.startsWith("ypub")) throw new Error("ypub (P2SH-P2WPKH) is not supported — use a zpub (native segwit)");
  return k.startsWith("xpub") ? XPUB_VERSIONS : ZPUB_VERSIONS;
}

export function deriveWatchOnlyAddress(extendedKey: string, index: number, hrp = "bc"): DerivedAddress {
  const versions = extendedKeyVersions(extendedKey, hrp);
  const hd = HDKey.fromExtendedKey(extendedKey.trim(), versions);
  const child = hd.derive(`m/0/${index}`);
  if (!child.publicKey) throw new Error("xpub derivation failed");
  return { mode: "watchonly", address: pubkeyToBech32Address(child.publicKey, hrp), index };
}

export { hash160, bech32Encode20, bytesToHex };
