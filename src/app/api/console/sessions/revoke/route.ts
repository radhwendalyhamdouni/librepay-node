/**
 * POST /api/console/sessions/revoke — kill one session or every other session.
 * Revoking sessions is a DEFENSIVE action, so it deliberately does NOT require
 * step-up (you should always be able to slam the door on an attacker).
 */

import { NextResponse } from "next/server";
import {
  authenticateConsole,
  resolveConsoleSession,
  revokeSession,
  revokeAllSessions,
} from "@/lib/server/console-auth";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authenticateConsole(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const current = await resolveConsoleSession(req);
  const body = (await req.json().catch(() => ({}))) as { id?: string; all?: boolean };

  if (body.all) {
    const n = await revokeAllSessions(current?.id);
    logSecurityEvent({ type: SecurityEventType.SESSION_REVOKED, severity: "warn", req, detail: `revoked ${n} other session(s)` });
    return NextResponse.json({ ok: true, revoked: n });
  }

  if (body.id) {
    const self = current?.id === body.id;
    const ok = await revokeSession(body.id);
    if (!ok) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    logSecurityEvent({ type: SecurityEventType.SESSION_REVOKED, severity: "warn", req, detail: self ? "revoked the current session" : "revoked one other session" });
    return NextResponse.json({ ok: true, self });
  }

  return NextResponse.json({ error: "BAD_REQUEST", detail: "provide id or all=true" }, { status: 400 });
}
