/**
 * PUT /api/system/backup/remote — configure the off-server backup target
 * (Bearer required). Target format: "user@host:/path" — delivered with
 * scp over SSH, so transport is always encrypted. An optional passphrase
 * additionally encrypts every archive at rest (AES-256-GCM).
 * body: { remoteTarget, remotePort?, passphrase?, clear? }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/server/api-auth";
import { pushRemote } from "@/lib/server/backup";
import { getSettings, saveSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  remoteTarget: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._:-]+:\//, "format: user@host:/path")
    .max(200)
    .or(z.literal("")),
  remotePort: z.number().int().min(1).max(65535).default(22),
  passphrase: z.string().min(8).max(200).or(z.literal("")).optional(),
  clear: z.boolean().optional(),
  test: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "VALIDATION", issues: body.error.issues.slice(0, 3) }, { status: 400 });
  }
  const b = body.data;

  if (b.clear) {
    saveSettings({ backup: { ...getSettings().backup, remoteTarget: "", passphrase: "" } });
    return NextResponse.json({ ok: true, cleared: true });
  }

  saveSettings({
    backup: {
      ...getSettings().backup,
      remoteTarget: b.remoteTarget,
      remotePort: b.remotePort,
      ...(b.passphrase !== undefined ? { passphrase: b.passphrase } : {}),
    },
  });

  if (b.test) {
    const push = await pushRemote();
    return NextResponse.json({ ok: true, saved: true, test: push }, { status: push.ok ? 200 : 207 });
  }
  return NextResponse.json({ ok: true, saved: true });
}
