/**
 * GET /api/console/claim?token=… — one-time RECOVERY link consumption.
 *
 * Minted by `bun run console:link` on the server (server access = proof of
 * ownership). Consumes the token atomically, opens a trusted 30-day session
 * and redirects to the console. Invalid/used/expired → redirected with a
 * failure flag; every attempt is audit-logged.
 */

import { NextResponse } from "next/server";
import { claimLinkToken, sessionCookieHeader } from "@/lib/server/console-auth";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

function redirect(req: Request, to: string, cookie?: string): NextResponse {
  const res = new NextResponse(null, {
    status: 303,
    headers: {
      Location: to, // relative — survives proxies and preview hosts
      ...(cookie ? { "set-cookie": cookie } : {}),
      "cache-control": "no-store",
    },
  });
  return res;
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return redirect(req, "/setup?claim=failed");

  const result = await claimLinkToken(token, req);
  if (result.ok) {
    return redirect(req, "/setup?claimed=1", sessionCookieHeader(result.sessionToken, req, result.trusted));
  }
  logSecurityEvent({
    type: SecurityEventType.LINK_CLAIM_FAILED,
    severity: "warn",
    req,
    detail: `recovery link claim failed: ${result.reason}`,
  });
  return redirect(req, "/setup?claim=failed");
}
