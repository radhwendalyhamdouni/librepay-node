/**
 * POST /api/console/login — the operator's daily login.
 *
 *   { password, totp?, trustDevice? }
 *
 * Escalating lockout (per-IP 5 fails → 15 min, doubling, cap 24h; plus a
 * global 20-fail bucket) guards the password; every failure lands on the
 * live security monitor. On success the session cookie is set — 8h sliding,
 * or 30d when trustDevice=true.
 */

import { NextResponse } from "next/server";
import { clientIp } from "@/lib/rate-limit";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";
import {
  createConsoleSession,
  sessionCookieHeader,
} from "@/lib/server/console-auth";
import {
  hasConsolePassword,
  verifyConsolePassword,
  totpEnabled,
  totpVerify,
  lockStatus,
  recordFailure,
  recordSuccess,
} from "@/lib/server/console-credential";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!hasConsolePassword()) {
    return NextResponse.json(
      { error: "NOT_SET_UP", detail: "no console password yet — use bootstrap with the operator API key" },
      { status: 409 }
    );
  }

  const ip = clientIp(req);
  const lock = lockStatus(ip);
  if (lock.locked) {
    logSecurityEvent({
      type: SecurityEventType.CONSOLE_LOCKED,
      severity: "warn",
      req,
      detail: `locked out — retry in ${Math.ceil(lock.retryAfter / 60)} min`,
    });
    return NextResponse.json(
      { error: "LOCKED", detail: `too many failed attempts — retry in ${Math.ceil(lock.retryAfter / 60)} min`, retryAfter: lock.retryAfter },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string; totp?: string; trustDevice?: boolean };
  const password = (body.password ?? "").trim();
  const totp = (body.totp ?? "").trim();
  const trustDevice = body.trustDevice === true;

  if (!verifyConsolePassword(password)) {
    recordFailure(ip);
    logSecurityEvent({ type: SecurityEventType.AUTH_FAILED, severity: "warn", req, detail: "console login: wrong password" });
    return NextResponse.json({ error: "WRONG_CREDENTIALS", detail: "wrong password" }, { status: 401 });
  }

  if (totpEnabled()) {
    if (!totp) {
      // password correct — ask for the second factor without revealing that the password was right
      return NextResponse.json({ error: "TOTP_REQUIRED", detail: "enter the 6-digit code from your authenticator" }, { status: 401 });
    }
    if (!totpVerify(totp)) {
      recordFailure(ip);
      logSecurityEvent({ type: SecurityEventType.AUTH_FAILED, severity: "warn", req, detail: "console login: wrong TOTP code" });
      return NextResponse.json({ error: "WRONG_CREDENTIALS", detail: "wrong authenticator code" }, { status: 401 });
    }
  }

  recordSuccess(ip);
  const token = await createConsoleSession("password", req, trustDevice);
  logSecurityEvent({
    type: SecurityEventType.CONSOLE_LOGIN,
    req,
    detail: `console unlocked with password${totpEnabled() ? " + TOTP" : ""}${trustDevice ? " (trusted device, 30d)" : ""}`,
  });
  return NextResponse.json(
    { ok: true },
    { headers: { "set-cookie": sessionCookieHeader(token, req, trustDevice) } }
  );
}
