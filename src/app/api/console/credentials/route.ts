/**
 * POST /api/console/credentials — manage the HUMAN credential (session required).
 *
 *   { action: "set-password",  password, currentPassword? }  first set: needs only the
 *                              firstrun/session; change: needs currentPassword
 *   { action: "totp-init" }                    → { otpauthUri, secret } (QR)
 *   { action: "totp-confirm",  code }          activate 2FA after scanning
 *   { action: "totp-disable",  password }      needs the password (step-up class)
 *
 * ALL actions are step-up sensitive when driven by a session: setting the
 * password, enrolling or disabling 2FA changes who can open the console.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateConsole, stepUpSatisfied, STEP_UP_REQUIRED } from "@/lib/server/console-auth";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";
import {
  hasConsolePassword,
  verifyConsolePassword,
  setConsolePassword,
  totpInit,
  totpConfirm,
  totpCancel,
  totpEnabled,
  PASSWORD_MIN,
} from "@/lib/server/console-credential";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authenticateConsole(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  // First-run exception: minting the FIRST password is the purpose of the
  // firstrun bootstrap session. Everything else requires fresh step-up.
  const firstSet = !hasConsolePassword();
  if (!firstSet && !stepUpSatisfied(auth)) {
    return NextResponse.json(STEP_UP_REQUIRED, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    password?: string;
    currentPassword?: string;
    code?: string;
  };

  if (body.action === "set-password") {
    const password = (body.password ?? "").trim();
    if (password.length < PASSWORD_MIN) {
      return NextResponse.json({ error: "WEAK_PASSWORD", detail: `min ${PASSWORD_MIN} characters` }, { status: 400 });
    }
    if (!firstSet && auth.method === "session") {
      // changing the password also requires knowing the current one
      if (!verifyConsolePassword((body.currentPassword ?? "").trim())) {
        logSecurityEvent({ type: SecurityEventType.STEP_UP_FAILED, severity: "warn", req, detail: "password change: current password mismatch" });
        return NextResponse.json({ error: "WRONG_CREDENTIALS", detail: "current password is wrong" }, { status: 401 });
      }
    }
    setConsolePassword(password);
    // The operator just proved identity (key bootstrap or current password):
    // open the 5-minute sensitive window so 2FA enrollment works immediately.
    if (auth.method === "session") {
      await db.consoleSession.update({ where: { id: auth.session.id }, data: { stepUpAt: new Date() } }).catch(() => {});
    }
    logSecurityEvent({
      type: SecurityEventType.CONSOLE_PASSWORD_SET,
      severity: "critical",
      req,
      detail: firstSet ? "console password created — API key no longer needed in the browser" : "console password changed",
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "totp-init") {
    if (totpEnabled()) {
      return NextResponse.json({ error: "ALREADY_ENABLED", detail: "2FA is already active — disable it first" }, { status: 409 });
    }
    const storeName = getSettings().storeName;
    const { otpauthUri, secret } = totpInit(storeName);
    logSecurityEvent({ type: SecurityEventType.STEP_UP_OK, req, detail: "2FA enrollment started (unconfirmed)" });
    return NextResponse.json({ ok: true, otpauthUri, secret });
  }

  if (body.action === "totp-confirm") {
    if (!totpConfirm((body.code ?? "").trim())) {
      logSecurityEvent({ type: SecurityEventType.STEP_UP_FAILED, severity: "warn", req, detail: "2FA confirm: wrong code" });
      return NextResponse.json({ error: "WRONG_CODE", detail: "wrong code — check your authenticator clock and try the next code" }, { status: 401 });
    }
    logSecurityEvent({ type: SecurityEventType.CONSOLE_TOTP_ENABLED, severity: "critical", req, detail: "2FA (TOTP) activated for console login" });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "totp-disable") {
    if (!verifyConsolePassword((body.password ?? "").trim())) {
      logSecurityEvent({ type: SecurityEventType.STEP_UP_FAILED, severity: "warn", req, detail: "2FA disable: password mismatch" });
      return NextResponse.json({ error: "WRONG_CREDENTIALS", detail: "password is wrong" }, { status: 401 });
    }
    totpCancel();
    logSecurityEvent({ type: SecurityEventType.CONSOLE_TOTP_DISABLED, severity: "critical", req, detail: "2FA (TOTP) disabled for console login" });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
