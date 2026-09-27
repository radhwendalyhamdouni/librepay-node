/**
 * GET  /api/system/security — security monitor payload (Bearer required):
 *        · encryption-at-rest status for every server-held secret
 *        · 24h stats (failed unlocks, throttles, SSRF blocks)
 *        · newest 60 events for the console's live monitor
 * POST /api/system/security — operator actions:
 *        { action: "encrypt-secrets" }  migrate plaintext secrets to AES-256-GCM
 *        { action: "purge-log" }        wipe the security log (operator's call)
 */

import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/server/api-auth";
import { getSettings, saveSettings } from "@/lib/server/settings";
import { encryptServerSecret } from "@/lib/server/crypto-server";
import { db } from "@/lib/db";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function encryptionStatus() {
  const s = getSettings();
  return {
    apiKey: { status: "hash-only", detail: "sha256 stored — raw key never touches disk" },
    phoenixdPassword: env.LIGHTNING_PASSWORD
      ? { status: "env", detail: "plaintext in .env (operator-managed) — console-stored copy is encrypted" }
      : s.lightning.passwordEnc
        ? { status: "encrypted", detail: "AES-256-GCM in config.json" }
        : s.lightning.password
          ? { status: "plaintext", detail: "legacy plaintext in config.json — migrate now" }
          : { status: "none", detail: "Lightning not configured" },
    backupPassphrase: s.backup.passphraseEnc
      ? { status: "encrypted", detail: "AES-256-GCM in config.json" }
      : s.backup.passphrase
        ? { status: "plaintext", detail: "legacy plaintext in config.json — migrate now" }
        : { status: "none", detail: "backups stored unencrypted" },
    webhookSecrets: { status: "env-or-config", detail: "operator-held; snapshots ride signed deliveries only" },
  };
}

export async function GET(req: Request) {
  if (!(await authenticateApiKey(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const since = new Date(Date.now() - 24 * 3600_000);
  let events: unknown[] = [];
  let stats = { failed24h: 0, throttled24h: 0, blocked24h: 0, total: 0 };
  try {
    const rows = await db.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
    events = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    const [failed24h, throttled24h, blocked24h, total] = await Promise.all([
      db.securityEvent.count({ where: { type: SecurityEventType.AUTH_FAILED, createdAt: { gte: since } } }),
      db.securityEvent.count({ where: { type: SecurityEventType.RATE_LIMITED, createdAt: { gte: since } } }),
      db.securityEvent.count({ where: { type: SecurityEventType.SSRF_BLOCKED, createdAt: { gte: since } } }),
      db.securityEvent.count(),
    ]);
    stats = { failed24h, throttled24h, blocked24h, total };
  } catch {
    // db unreachable — render empty monitor rather than failing the console
  }

  return NextResponse.json({ ok: true, encryption: encryptionStatus(), stats, events });
}

export async function POST(req: Request) {
  if (!(await authenticateApiKey(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action ?? "";

  if (action === "encrypt-secrets") {
    const s = getSettings();
    let migrated = 0;
    const patch: Parameters<typeof saveSettings>[0] = {};
    if (!s.backup.passphraseEnc && s.backup.passphrase) {
      patch.backup = { ...s.backup, passphrase: "", passphraseEnc: encryptServerSecret(s.backup.passphrase) };
      migrated++;
    }
    if (!s.lightning.passwordEnc && s.lightning.password && !env.LIGHTNING_PASSWORD) {
      patch.lightning = { ...s.lightning, password: "", passwordEnc: encryptServerSecret(s.lightning.password) };
      migrated++;
    }
    if (migrated > 0) saveSettings(patch);
    logSecurityEvent({
      type: SecurityEventType.SECRETS_ENCRYPTED,
      severity: "critical",
      req,
      detail: migrated > 0 ? `${migrated} secret(s) migrated to AES-256-GCM at rest` : "no plaintext secrets to migrate",
    });
    return NextResponse.json({ ok: true, migrated, encryption: encryptionStatus() });
  }

  if (action === "purge-log") {
    await db.securityEvent.deleteMany({});
    return NextResponse.json({ ok: true, purged: true });
  }

  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
