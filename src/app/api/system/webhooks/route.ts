/**
 * GET  /api/system/webhooks — list configured webhook destinations (Bearer).
 * PUT  /api/system/webhooks — replace the destination list (Bearer).
 * POST /api/system/webhooks — { action: "redrive" } requeues dead deliveries.
 *
 * Merchants connect stores (WooCommerce, custom carts) by registering the
 * URL that should receive signed invoice events. This endpoint exists so
 * the operator console can manage destinations without SSH-ing into the
 * server — part of the "connect your shop" journey.
 *
 * Validation mirrors the delivery guard: https-only (loopback allowed only
 * when LP_ALLOW_LOOPBACK_WEBHOOKS is on — a documented local-testing flag).
 */

import { NextResponse } from "next/server";
import {
  authenticateConsole,
  stepUpSatisfied,
  STEP_UP_REQUIRED,
} from "@/lib/server/console-auth";
import { getSettings, saveSettings } from "@/lib/server/settings";
import { assertOutboundUrl } from "@/lib/server/ssrf-guard";
import { redriveDeadDeliveries } from "@/lib/server/webhook";
import { env } from "@/lib/env";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await authenticateConsole(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, urls: getSettings().webhookUrls });
}

export async function PUT(req: Request) {
  const auth = await authenticateConsole(req);
  if (!auth) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  // STEP-UP: changing webhook destinations is the payment-redirection attack
  // a stolen cookie would attempt first — it re-asks the operator password.
  if (!stepUpSatisfied(auth)) {
    return NextResponse.json(STEP_UP_REQUIRED, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { urls?: unknown };
  const urls = Array.isArray(body.urls) ? body.urls : null;
  if (!urls || urls.length > 10) {
    return NextResponse.json({ error: "INVALID_INPUT", detail: "urls: string[] (max 10)" }, { status: 400 });
  }

  const cleaned: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== "string" || raw.length > 2048) {
      return NextResponse.json({ error: "INVALID_INPUT", detail: "bad url" }, { status: 400 });
    }
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      // same guard the delivery worker uses — reject unreachable/unsafe targets up front
      assertOutboundUrl(trimmed, {
        allowInsecureDev: env.NODE_ENV !== "production" || env.ALLOW_LOOPBACK_WEBHOOKS,
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : "url rejected";
      return NextResponse.json({ error: "INVALID_URL", detail }, { status: 400 });
    }
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
  }

  saveSettings({ webhookUrls: cleaned });
  logSecurityEvent({
    type: SecurityEventType.WEBHOOKS_UPDATED,
    severity: "info",
    req,
    detail: `webhook destinations set (${cleaned.length})`,
  });
  return NextResponse.json({ ok: true, urls: cleaned });
}

export async function POST(req: Request) {
  if (!(await authenticateConsole(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "redrive") {
    return NextResponse.json({ error: "INVALID_INPUT", detail: "action must be 'redrive'" }, { status: 400 });
  }
  // Rescue lane: requeue every dead delivery. Safe by construction —
  // deliveries keep their ENQUEUED url + secret snapshot and are re-signed
  // at send time, so redrive cannot redirect a payload to a new destination.
  const redriven = await redriveDeadDeliveries();
  logSecurityEvent({
    type: SecurityEventType.WEBHOOKS_UPDATED,
    severity: "info",
    req,
    detail: `webhook redrive — ${redriven} dead deliveries requeued`,
  });
  return NextResponse.json({ ok: true, redriven });
}
