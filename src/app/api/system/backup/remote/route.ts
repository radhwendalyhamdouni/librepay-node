/**
 * PUT /api/system/backup/remote — configure the off-server backup target
 * (Bearer required). Target format: "user@host:/path" — delivered with
 * scp over SSH, so transport is always encrypted. An optional passphrase
 * additionally encrypts every archive at rest (AES-256-GCM).
 * body: { remoteTarget, remotePort?, passphrase?, clear? }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateConsole,
  stepUpSatisfied,
  STEP_UP_REQUIRED,
} from "@/lib/server/console-auth";
import { pushRemote } from "@/lib/server/backup";
import { getSettings, saveSettings } from "@/lib/server/settings";
import { encryptServerSecret } from "@/lib/server/crypto-server";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

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
  const auth = await authenticateConsole(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // STEP-UP: redirecting backups (or their passphrase) is an operator-level change.
  if (!stepUpSatisfied(auth)) {
    return NextResponse.json(STEP_UP_REQUIRED, { status: 403 });
  }

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "VALIDATION", issues: body.error.issues.slice(0, 3) }, { status: 400 });
  }
  const b = body.data;

  if (b.clear) {
    saveSettings({ backup: { ...getSettings().backup, remoteTarget: "", passphrase: "", passphraseEnc: null } });
    logSecurityEvent({ type: SecurityEventType.BACKUP_CREATED, severity: "info", req, detail: "remote backup target cleared" });
    return NextResponse.json({ ok: true, cleared: true });
  }

  saveSettings({
    backup: {
      ...getSettings().backup,
      remoteTarget: b.remoteTarget,
      remotePort: b.remotePort,
      ...(b.passphrase !== undefined
        ? b.passphrase
          ? { passphraseEnc: encryptServerSecret(b.passphrase), passphrase: "" } // encrypted at rest
          : { passphraseEnc: null, passphrase: "" }
        : {}),
    },
  });
  logSecurityEvent({ type: SecurityEventType.BACKUP_CREATED, req, detail: `remote target saved (${b.test ? "with" : "without"} test push)` });

  if (b.test) {
    const push = await pushRemote();
    return NextResponse.json({ ok: true, saved: true, test: push }, { status: push.ok ? 200 : 207 });
  }
  return NextResponse.json({ ok: true, saved: true });
}
