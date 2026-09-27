/**
 * POST /api/console/step-up — re-confirm the password for sensitive actions.
 *
 * Sensitive endpoints (rotate API key, change webhook destinations, restore
 * backups, change credentials, connect Lightning) require a session whose
 * stepUpAt is younger than 5 minutes. A stolen cookie can therefore only
 * READ — it cannot redirect payments or rotate secrets without the password.
 */

import { NextResponse } from "next/server";
import { clientIp } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";
import { resolveConsoleSession } from "@/lib/server/console-auth";
import { verifyConsolePassword, totpEnabled, totpVerify, lockStatus, recordFailure, recordSuccess } from "@/lib/server/console-credential";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await resolveConsoleSession(req);
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const ip = clientIp(req);
  const lock = lockStatus(ip);
  if (lock.locked) {
    return NextResponse.json(
      { error: "LOCKED", detail: `too many failed attempts — retry in ${Math.ceil(lock.retryAfter / 60)} min`, retryAfter: lock.retryAfter },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string; totp?: string };
  const password = (body.password ?? "").trim();

  if (!verifyConsolePassword(password)) {
    recordFailure(ip);
    logSecurityEvent({ type: SecurityEventType.STEP_UP_FAILED, severity: "warn", req, detail: "step-up: wrong password" });
    return NextResponse.json({ error: "WRONG_CREDENTIALS", detail: "wrong password" }, { status: 401 });
  }
  if (totpEnabled()) {
    const totp = (body.totp ?? "").trim();
    if (!totpVerify(totp)) {
      recordFailure(ip);
      logSecurityEvent({ type: SecurityEventType.STEP_UP_FAILED, severity: "warn", req, detail: "step-up: wrong TOTP code" });
      return NextResponse.json({ error: "WRONG_CREDENTIALS", detail: "wrong authenticator code" }, { status: 401 });
    }
  }

  recordSuccess(ip);
  await db.consoleSession.update({ where: { id: session.id }, data: { stepUpAt: new Date() } });
  logSecurityEvent({ type: SecurityEventType.STEP_UP_OK, req, detail: "sensitive-action window opened (5 min)" });
  return NextResponse.json({ ok: true });
}
