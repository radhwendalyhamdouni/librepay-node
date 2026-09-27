/**
 * POST /api/system/backup/restore — stage a restore (Bearer required).
 * Accepts either { name } (an archive in data/backups) or a raw uploaded
 * .lplbackup body. Files are staged into data/restore-pending/ — nothing
 * is overwritten while the node is running. `npm run restore` applies the
 * staged files (with a pre-restore snapshot), then the operator restarts.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateConsole,
  stepUpSatisfied,
  STEP_UP_REQUIRED,
} from "@/lib/server/console-auth";
import { stageRestore, stageRestoreFromUpload } from "@/lib/server/backup";

export const dynamic = "force-dynamic";

const nameSchema = z.object({ name: z.string().min(5).max(120) });

export async function POST(req: Request) {
  const auth = await authenticateConsole(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // STEP-UP: a restore can replace every operator setting — re-ask the password.
  if (!stepUpSatisfied(auth)) {
    return NextResponse.json(STEP_UP_REQUIRED, { status: 403 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/octet-stream")) {
      const buf = Buffer.from(await req.arrayBuffer());
      const filename = (req.headers.get("x-backup-name") ?? "upload.lplbackup").slice(0, 120);
      const manifest = stageRestoreFromUpload(buf, filename);
      return NextResponse.json({ ok: true, staged: manifest }, { status: 202 });
    }
    const body = nameSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const manifest = stageRestore(body.data.name);
    return NextResponse.json({ ok: true, staged: manifest }, { status: 202 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "restore staging failed" },
      { status: 400 }
    );
  }
}
