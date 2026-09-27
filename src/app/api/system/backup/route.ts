/**
 * /api/system/backup — list (GET) and create (POST) operator backups.
 * Both require the Bearer API key. POST optionally pushes to the
 * configured off-server SSH target (body { pushRemote: true }).
 */

import { NextResponse } from "next/server";
import { authenticateConsole } from "@/lib/server/console-auth";
import { createBackup, listBackups, pushRemote } from "@/lib/server/backup";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateConsole(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ backups: listBackups() });
}

export async function POST(req: Request) {
  const auth = await authenticateConsole(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const created = await createBackup("manual");
    const pushed = body?.pushRemote ? await pushRemote() : null;
    return NextResponse.json({ ok: true, ...created, push: pushed }, { status: 201 });
  } catch (e) {
    console.error("[backup]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "backup failed" },
      { status: 500 }
    );
  }
}
