/**
 * Manual cron tick — for systemd-timer / external-scheduler operators
 * who set LP_CRON_INTERVAL_MS=0. Guarded by LP_CRON_SECRET (bearer).
 */

import { NextResponse } from "next/server";
import { cronTick } from "@/lib/server/invoice-events";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/server/crypto-server";

export async function POST(req: Request) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "cron disabled" }, { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ""), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await cronTick();
  return NextResponse.json({ ok: true, result });
}
