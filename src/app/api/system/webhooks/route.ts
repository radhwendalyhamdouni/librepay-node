/**
 * GET  /api/system/webhooks — list configured webhook destinations (Bearer).
 * PUT  /api/system/webhooks — replace the destination list (Bearer).
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
import { authenticateApiKey } from "@/lib/server/api-auth";
import { getSettings, saveSettings } from "@/lib/server/settings";
import { assertOutboundUrl } from "@/lib/server/ssrf-guard";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await authenticateApiKey(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, urls: getSettings().webhookUrls });
}

export async function PUT(req: Request) {
  if (!(await authenticateApiKey(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
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
  return NextResponse.json({ ok: true, urls: cleaned });
}
