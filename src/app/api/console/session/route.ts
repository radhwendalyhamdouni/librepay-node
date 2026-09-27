/**
 * GET /api/console/session — login-screen state discovery.
 * Returns only booleans (no secrets) so the login page knows which form to
 * render: bootstrap (no password yet) / password / password+TOTP, and whether
 * an existing cookie session is already alive.
 */

import { NextResponse } from "next/server";
import { resolveConsoleSession, stepUpFresh } from "@/lib/server/console-auth";
import { hasConsolePassword, totpEnabled } from "@/lib/server/console-credential";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await resolveConsoleSession(req);
  return NextResponse.json({
    authenticated: !!session,
    method: session ? session.method : null,
    stepUpFresh: session ? stepUpFresh(session) : false,
    passwordSet: hasConsolePassword(),
    totpEnabled: totpEnabled(),
  });
}
