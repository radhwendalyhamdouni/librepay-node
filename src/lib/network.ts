/**
 * LibrePay Node — network selector (isomorphic, no env access).
 *
 * The node is mainnet by default. Setting LP_NETWORK=testnet (or testnet4)
 * switches EVERYTHING that must move together:
 *   - address HRP: bc1… → tb1…
 *   - watch-only key flavor: zpub/xpub → vpub/tpub (SLIP-132 testnet versions)
 *   - BIP84 account coin type: m/84'/0'/0' → m/84'/1'/0'
 *   - default Esplora endpoint: mempool.space → mempool.space/testnet4
 *   - explorer links: /tx/… → /testnet4/tx/…
 *
 * TESTNET = TESTNET4 here (mempool.space serves a public testnet4 Esplora
 * API + faucet; testnet3 is deprecated/spam-ridden). Signet is deliberately
 * NOT routed through this flag: it needs a self-hosted Esplora with its own
 * path layout — run it via ESPLORA_API if you know what you are doing.
 */

export type Network = "mainnet" | "testnet";

export function parseNetwork(value: string | undefined | null): Network {
  const s = (value ?? "").trim().toLowerCase();
  return s === "testnet" || s === "testnet4" ? "testnet" : "mainnet";
}

/** bech32 human-readable part for P2WPKH addresses on this network. */
export function hrpFor(network: Network): "bc" | "tb" {
  return network === "testnet" ? "tb" : "bc";
}

/** BIP44/84 coin type: 0 mainnet, 1 testnet. */
export function coinTypeFor(network: Network): 0 | 1 {
  return network === "testnet" ? 1 : 0;
}

/** Path prefix appended to a mempool-style explorer host for tx links. */
export function explorerPathFor(network: Network): string {
  return network === "testnet" ? "/testnet4" : "";
}
