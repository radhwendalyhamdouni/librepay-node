/**
 * GET /api/console/sessions — list active console sessions (devices).
 * The operator sees every open door: method, IP, device, last activity.
 */

import { NextResponse } from "next/server";
import {
  authenticateConsole,
  resolveConsoleSession,
  listActiveSessions,
} from "@/lib/server/console-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await authenticateConsole(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const current = await resolveConsoleSession(req);
  const sessions = await listActiveSessions();
  return NextResponse.json({ ok: true, currentId: current?.id ?? null, sessions });
}
