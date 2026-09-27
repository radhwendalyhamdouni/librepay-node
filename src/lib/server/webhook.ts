/**
 * Outgoing webhooks — HMAC-SHA256 signed, queued in DB, retried with
 * exponential backoff by the cron worker.
 *
 * Signature header:  X-LibrePay-Signature: sha256=<hex hmac of raw body>
 * Also sent:         X-LibrePay-Event, X-LibrePay-Delivery-Id, X-LibrePay-Timestamp
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { db } from "@/lib/db";
import { assertOutboundUrl } from "./ssrf-guard";
import { getWebhookEndpoints } from "@/lib/config";
import { env } from "@/lib/env";

interface WebhookPayloadLike { timestamp?: number }

export interface WebhookPayload {
  event: string;
  invoiceId?: string;
  subscriptionId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export function signPayload(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = signPayload(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bodyHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

const RETRY_SCHEDULE_MIN = [1, 5, 15, 60, 360, 1440]; // ~8 attempts
const MAX_ATTEMPTS = RETRY_SCHEDULE_MIN.length + 1;

/** Queue deliveries for every configured endpoint (env: LP_WEBHOOK_URLS/SECRETS). */
export async function enqueueWebhooks(
  merchantId: string,
  event: string,
  invoiceId: string,
  data: Record<string, unknown>
): Promise<number> {
  const endpoints = getWebhookEndpoints();
  let queued = 0;
  for (const ep of endpoints) {
    // The node subscribes endpoints to ALL invoice events — filtering is
    // the receiver's job (same contract as the platform's "all events" default).
    if (!ep.secret) continue;
    void merchantId;
    const payload: WebhookPayload = {
      event,
      invoiceId,
      data,
      timestamp: Date.now(),
    };
    await db.webhookDelivery.create({
      data: {
        url: ep.url,
        secret: ep.secret,
        invoiceId,
        event,
        payload: JSON.stringify(payload),
        status: "pending",
        nextRetryAt: new Date(),
      },
    });
    queued++;
  }
  return queued;
}

/** Attempt pending deliveries (cron). Returns processed count. */
export async function processPendingDeliveries(limit = 25): Promise<number> {
  const due = await db.webhookDelivery.findMany({
    where: { status: "pending", nextRetryAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let processed = 0;
  for (const d of due) {
    // url + secret were snapshotted onto the delivery row at enqueue time —
    // editing .env later cannot orphan or redirect in-flight deliveries.
    if (!d.url || !d.secret) {
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "dead", lastError: "endpoint removed" } });
      continue;
    }
    const attempts = d.attempts + 1;
    try {
      // Re-validate the endpoint URL at DELIVERY time (not just registration):
      // a DNS-rebound host or a URL that became private must never be fetched.
      // Redirects are NOT followed (redirect:"manual") so a 30x cannot bounce
      // the signed payload onto an internal address. localhost is allowed
      // OUTSIDE PRODUCTION, or when the operator explicitly opts in via
      // LP_ALLOW_LOOPBACK_WEBHOOKS=true (local shop integration tests).
      assertOutboundUrl(d.url, {
        allowInsecureDev:
          env.NODE_ENV !== "production" || env.ALLOW_LOOPBACK_WEBHOOKS,
      });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      // Receiver-side freshness: document says we send a timestamp header — do it.
      let ts = "";
      try { ts = String((JSON.parse(d.payload) as WebhookPayloadLike).timestamp ?? ""); } catch { ts = ""; }
      const res = await fetch(d.url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "user-agent": "LibrePay-Webhooks/1.0",
          "x-librepay-event": d.event,
          "x-librepay-delivery-id": d.id,
          "x-librepay-timestamp": ts,
          "x-librepay-signature": signPayload(d.secret, d.payload),
        },
        body: d.payload,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const ok = res.ok;
      const errNote = !ok
        ? res.status >= 300 && res.status < 400
          ? "redirect rejected (SSRF guard)"
          : `HTTP ${res.status}`
        : null;
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts,
          responseStatus: res.status,
          status: ok ? "success" : attempts >= MAX_ATTEMPTS ? "dead" : "pending",
          lastError: ok ? null : errNote,
          nextRetryAt: ok ? null : minutesFromNow(RETRY_SCHEDULE_MIN[Math.min(attempts - 1, RETRY_SCHEDULE_MIN.length - 1)]),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network error";
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts,
          status: attempts >= MAX_ATTEMPTS ? "dead" : "pending",
          lastError: msg.slice(0, 300),
          nextRetryAt: minutesFromNow(RETRY_SCHEDULE_MIN[Math.min(attempts - 1, RETRY_SCHEDULE_MIN.length - 1)]),
        },
      });
    }
    processed++;
  }
  return processed;
}

function minutesFromNow(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}
