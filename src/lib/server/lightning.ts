/**
 * Phoenixd client (ACINQ's minimal Lightning server) — for the merchant's
 * OWN node. Non-custodial: we only ever call
 *   GET  /getinfo              (health check)
 *   POST /createinvoice        (mint a bolt11 for an amount)
 *   GET  /payments/incoming/{paymentHash}  (watch for completion)
 *   POST /webhooks/add         (register payment_received webhooks)
 * We NEVER call /payinvoice — the platform cannot spend a satoshi of the
 * merchant's Lightning balance.
 *
 * Auth: HTTP Basic with empty user + http-password as the password.
 */

import { createHmac } from "node:crypto";
import { guardOutboundUrl } from "./ssrf-guard";
import { decryptServerSecret, appSecret } from "./crypto-server";
import { env } from "@/lib/env";

export interface PhoenixdInvoice {
  paymentHash: string;
  preimage: string | null;
  serialId?: string;
  bolt11: string;
  amountMsat: number;
  description?: string;
  externalId?: string;
  completedAt?: number | null;
  createdAt?: number | null;
}

export interface PhoenixdNodeInfo {
  name?: string;
  pubkey?: string;
  chain?: string;
  version?: string;
}

const TIMEOUT_MS = 8_000;

function basicAuth(password: string): string {
  return "Basic " + Buffer.from(`:${password}`).toString("base64");
}

async function call<T>(
  baseUrl: string,
  password: string,
  path: string,
  init?: { method?: string; body?: Record<string, string> }
): Promise<T> {
  // SSRF guard (https, no private ranges; localhost permitted in dev for tests)
  const g = guardOutboundUrl(baseUrl, {
    allowInsecureDev: process.env.NODE_ENV !== "production" && /localhost|127\.0\.0\.1/.test(baseUrl),
  });
  if (!g.ok) throw new PhoenixdError(g.reason);
  const base = g.url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${base.origin}${path}`;
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        authorization: basicAuth(password),
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: init?.body ? new URLSearchParams(init.body).toString() : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        detail = (JSON.parse(text) as { error?: string; message?: string }).error ??
          (JSON.parse(text) as { message?: string }).message ?? detail;
      } catch { /* keep raw text */ }
      throw new PhoenixdError(`phoenixd_${res.status}: ${detail}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export class PhoenixdError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PhoenixdError";
  }
}

export function phoenixdGetInfo(baseUrl: string, password: string): Promise<PhoenixdNodeInfo> {
  return call<PhoenixdNodeInfo>(baseUrl, password, "/getinfo");
}

/** Create a bolt11 invoice. amountMsat: millisatoshis. externalId: our invoice id. */
export async function phoenixdCreateInvoice(
  baseUrl: string,
  password: string,
  params: { amountMsat: number; description: string; externalId: string }
): Promise<PhoenixdInvoice> {
  const res = await call<Record<string, unknown>>(baseUrl, password, "/createinvoice", {
    method: "POST",
    body: {
      amountMsat: String(params.amountMsat),
      description: params.description.slice(0, 200),
      externalId: params.externalId,
    },
  });
  const bolt11 = (res.paymentRequest as string) ?? (res.getBolt11 as string) ?? (res.getinvoice as string);
  if (!bolt11) throw new PhoenixdError("phoenixd_missing_bolt11");
  return {
    paymentHash: String(res.paymentHash ?? ""),
    preimage: (res.preimage as string) ?? null,
    serialId: res.serialId as string | undefined,
    bolt11,
    amountMsat: params.amountMsat,
    description: params.description,
    externalId: params.externalId,
  };
}

/** Look up an incoming payment by hash. Returns null when not found. */
export async function phoenixdGetIncoming(
  baseUrl: string,
  password: string,
  paymentHash: string
): Promise<PhoenixdInvoice | null> {
  try {
    const res = await call<Record<string, unknown>>(
      baseUrl,
      password,
      `/payments/incoming/${encodeURIComponent(paymentHash)}`
    );
    const msat = Number(res.amountMsat ?? res.receivedMsat ?? 0);
    const completed = res.completedAt != null || res.isPaid === true || res.status === "paid" || res.settled === true;
    return {
      paymentHash,
      preimage: (res.preimage as string) ?? null,
      bolt11: (res.paymentRequest as string) ?? "",
      amountMsat: msat,
      description: res.description as string | undefined,
      externalId: res.externalId as string | undefined,
      completedAt: completed ? Number(res.completedAt ?? Date.now()) : null,
      createdAt: Number(res.createdAt ?? 0) || undefined,
    };
  } catch (err) {
    // 404 → not found yet; anything else → surface
    if (err instanceof PhoenixdError && /phoenixd_404/.test(err.message)) return null;
    throw err;
  }
}

/** Best-effort webhook registration (payment_received). Fails silently — cron polling is the fallback. */
export async function phoenixdRegisterWebhook(
  baseUrl: string,
  password: string,
  webhookUrl: string
): Promise<boolean> {
  try {
    await call(baseUrl, password, `/webhooks/add?url=${encodeURIComponent(webhookUrl)}&subscription=payment_received`, {
      method: "POST",
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Merchant convenience wrappers
// ---------------------------------------------------------------------------

export function lightningPasswordOf(merchant: { lightningPasswordEnc: string | null }): string | null {
  // Node edition: the operator's phoenixd password lives in .env — env wins.
  if (env.LIGHTNING_PASSWORD) return env.LIGHTNING_PASSWORD;
  if (!merchant.lightningPasswordEnc) return null;
  try {
    return decryptServerSecret(merchant.lightningPasswordEnc);
  } catch {
    return null;
  }
}

export function lightningWebhookUrl(appOrigin: string, merchantId: string, token: string): string {
  return `${appOrigin}/api/lightning/phoenixd/${merchantId}?t=${token}`;
}

/** Stable verification token binding the webhook to a merchant (receiver re-verifies with the node anyway). */
export function lightningWebhookToken(merchantId: string): string {
  const secret = appSecret();
  return createHmac("sha256", secret).update(`ln-webhook:${merchantId}`).digest("hex").slice(0, 24);
}
