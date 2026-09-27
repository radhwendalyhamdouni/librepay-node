/**
 * GET /api/system/backup/[name] — download one archive (Bearer required).
 * Delivered over HTTPS (or loopback for local testing); the archive itself
 * is additionally AES-256-GCM encrypted when the operator set a passphrase.
 */

import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/server/api-auth";
import { readBackupFile } from "@/lib/server/backup";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { name } = await ctx.params;
  try {
    const bytes = readBackupFile(name);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "backup error" },
      { status: 404 }
    );
  }
}
