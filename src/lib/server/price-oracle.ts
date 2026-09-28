/**
 * Live BTC price oracle — the heart of USD-anchored pricing.
 *
 * Source chain (first reachable wins, cached 60s):
 *   1. mempool.space        /v1/prices        → { USD, EUR, ... }  (primary — "we show mempool.space's own price")
 *   2. api.coingecko.com    simple/price      → bitcoin.usd
 *   3. blockchain.info      /ticker           → USD.last
 *   4. static fallback rates                  → flagged as "fallback" (stale, checkout still works)
 *
 * The displayed USD price never changes; only the sats equivalent floats.
 */

import { env } from "@/lib/env";
import { FALLBACK_RATES } from "./fallback-rates";

export interface PriceQuote {
  usdPerBtc: number;
  source: "mempool.space" | "coingecko" | "blockchain.info" | "fallback";
  ts: number;
  rates: Record<string, number>; // fiat per BTC (best effort beyond USD)
}

const CACHE_TTL_MS = 30_000;
let cache: PriceQuote | null = null;
let inFlight: Promise<PriceQuote> | null = null;

async function fetchJson<T>(url: string, timeoutMs = 6_000): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "LibrePay/1.0" },
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fromMempool(): Promise<PriceQuote | null> {
  // BTC's fiat price is chain-independent — on a testnet node (whose Esplora
  // may not serve /v1/prices) pull the quote from the mainnet API instead.
  const url =
    env.NETWORK === "testnet" ? "https://mempool.space/api/v1/prices" : `${env.ESPLORA_API}/v1/prices`;
  const data = await fetchJson<Record<string, number>>(url);
  if (!data || typeof data.USD !== "number" || data.USD <= 0) return null;
  const { time: _time, ...rates } = data;
  return { usdPerBtc: data.USD, source: "mempool.space", ts: Date.now(), rates };
}

async function fromCoinGecko(): Promise<PriceQuote | null> {
  const data = await fetchJson<{ bitcoin?: { usd?: number } }>(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  );
  const usd = data?.bitcoin?.usd;
  if (!usd || usd <= 0) return null;
  return { usdPerBtc: usd, source: "coingecko", ts: Date.now(), rates: { USD: usd } };
}

async function fromBlockchainInfo(): Promise<PriceQuote | null> {
  const data = await fetchJson<{ USD?: { last?: number } }>("https://blockchain.info/ticker");
  const usd = data?.USD?.last;
  if (!usd || usd <= 0) return null;
  return { usdPerBtc: usd, source: "blockchain.info", ts: Date.now(), rates: { USD: usd } };
}

function fallbackQuote(): PriceQuote {
  return {
    usdPerBtc: FALLBACK_RATES.USD,
    source: "fallback",
    ts: Date.now(),
    rates: FALLBACK_RATES,
  };
}

export async function getBtcPrice(): Promise<PriceQuote> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    for (const source of [fromMempool, fromCoinGecko, fromBlockchainInfo]) {
      const q = await source();
      if (q) {
        cache = q;
        return q;
      }
    }
    const q = fallbackQuote();
    // fallback is cached for a SHORTER window so live sources are retried soon
    cache = { ...q, ts: Date.now() - (CACHE_TTL_MS - 15_000) };
    return q;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
