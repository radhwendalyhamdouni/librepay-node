/**
 * Health check — liveness + database.
 *
 * 200 {ok:true, db:true}   — app AND database are alive
 * 503 {ok:false, db:false} — database unreachable (the process still answers,
 *                            which is exactly what tells the monitor things
 *                            are NOT fine)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: true, service: "librepay-node", ts: Date.now() });
  } catch {
    return NextResponse.json({ ok: false, db: false, service: "librepay-node", ts: Date.now() }, { status: 503 });
  }
}
