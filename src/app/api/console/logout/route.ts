/**
 * POST /api/console/logout — revoke the current session and clear the cookie.
 */

import { NextResponse } from "next/server";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";
import {
  resolveConsoleSession,
  revokeSession,
  clearedCookieHeader,
} from "@/lib/server/console-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await resolveConsoleSession(req);
  if (session) {
    await revokeSession(session.id);
    logSecurityEvent({ type: SecurityEventType.CONSOLE_LOGOUT, req, detail: "console locked by operator" });
  }
  return NextResponse.json({ ok: true }, { headers: { "set-cookie": clearedCookieHeader() } });
}
