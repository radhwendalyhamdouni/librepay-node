/**
 * Esplora API client (mempool.space by default — no node required).
 * Server-side only. All calls tolerate failure (return null) so the cron
 * loop keeps running even when the API is briefly unreachable.
 */

import { env } from "@/lib/env";
import { recordChainFailure, recordChainSuccess, recordTipHeight } from "./chain-health";

export interface EsploraTxVout {
  scriptpubkey: string;
  scriptpubkey_address?: string;
  value: number;
}
export interface EsploraTxVin {
  prevout?: EsploraTxVout | null;
}
export interface EsploraTx {
  txid: string;
  version: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vout: EsploraTxVout[];
  vin?: EsploraTxVin[];
}

async function get<T>(path: string, timeoutMs = 10_000): Promise<T | null> {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${env.ESPLORA_API}${path}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      // feeds the outage alarm: N consecutive failures ⇒ system.esplora_down
      recordChainFailure(`HTTP ${res.status} on ${path}`);
      return null;
    }
    const data = (await res.json()) as T;
    recordChainSuccess(Date.now() - started);
    return data;
  } catch (err) {
    recordChainFailure(err instanceof Error ? err.message : "network error");
    return null;
  }
}

/** Transactions seen for an address (mempool + confirmed). */
export async function getAddressTxs(address: string): Promise<EsploraTx[] | null> {
  return get<EsploraTx[]>(`/address/${encodeURIComponent(address)}/txs`);
}

/** Current chain tip height. Also feeds tip-stall detection in the health monitor. */
export async function getTipHeight(): Promise<number | null> {
  const height = await get<number>("/blocks/tip/height");
  if (typeof height === "number") recordTipHeight(height);
  return height;
}

/** Fiat rates: { time, USD, EUR, ... } — sats price per fiat unit *100? No: returns fiat per BTC. */
export async function getFiatRates(): Promise<Record<string, number> | null> {
  return get<Record<string, number>>("/v1/prices");
}

/**
 * Sum of outputs paid TO a specific address in a tx.
 * Returns 0 if the tx doesn't pay to this address at all.
 */
export function amountPaidToAddress(tx: EsploraTx, address: string): number {
  let sum = 0;
  for (const vout of tx.vout) {
    if (vout.scriptpubkey_address === address) sum += vout.value;
  }
  return sum;
}

export function confirmationsOf(tx: EsploraTx, tipHeight: number): number {
  if (!tx.status.confirmed || !tx.status.block_height) return 0;
  return Math.max(0, tipHeight - tx.status.block_height + 1);
}

/**
 * First external funding address of a tx (first input's prevout) — used as
 * the "payment origin" for optional refunds. May be undefined for coinbase
 * or SegWit-only edge cases. Note: origin may be an exchange address; the
 * refund UI warns the merchant about this.
 */
export function payerAddressOf(tx: EsploraTx): string | null {
  for (const vin of tx.vin ?? []) {
    const addr = vin?.prevout?.scriptpubkey_address;
    if (addr) return addr;
  }
  return null;
}
