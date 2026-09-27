/**
 * POST /api/console/bootstrap — FIRST-RUN console credential creation.
 *
 * Works ONLY while no console password exists. The operator proves ownership
 * by presenting the master API key ONCE (the same trust anchor BTCPay uses
 * with its first registration); the response mints a short "firstrun"
 * session whose only purpose is to let the console set the password + 2FA.
 * From then on the API key never has to enter a browser again.
 */

import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";
import { verifyOperatorKey, createConsoleSession, sessionCookieHeader } from "@/lib/server/console-auth";
import { hasConsolePassword } from "@/lib/server/console-credential";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (hasConsolePassword()) {
    return NextResponse.json(
      { error: "ALREADY_SET_UP", detail: "console password exists — use the login form or a recovery link" },
      { status: 409 }
    );
  }

  const ip = clientIp(req);
  if (!rateLimit(`consolebootstrap:${ip}`, 10, 10 * 60_000).ok) {
    logSecurityEvent({ type: SecurityEventType.RATE_LIMITED, severity: "warn", req, detail: "console bootstrap throttle tripped" });
    return NextResponse.json({ error: "RATE_LIMITED", detail: "too many attempts — wait a few minutes" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { apiKey?: string };
  const key = (body.apiKey ?? "").trim();
  if (!key) return NextResponse.json({ error: "API_KEY_REQUIRED" }, { status: 400 });

  if (!verifyOperatorKey(key)) {
    logSecurityEvent({ type: SecurityEventType.AUTH_FAILED, severity: "warn", req, detail: "console bootstrap: wrong operator key" });
    return NextResponse.json({ error: "WRONG_KEY", detail: "that is not the operator API key" }, { status: 401 });
  }

  // One-time-use session (8h) dedicated to completing the credential setup.
  const token = await createConsoleSession("firstrun", req, false);
  logSecurityEvent({ type: SecurityEventType.AUTH_OK, req, detail: "console bootstrap opened with operator key — set the password now" });
  return NextResponse.json(
    { ok: true, next: "set-password" },
    { headers: { "set-cookie": sessionCookieHeader(token, req, false) } }
  );
}
