/**
 * Security audit log — the operator's continuous monitor.
 *
 * Every security-relevant moment lands here: failed key attempts (someone
 * guessing), SSRF blocks (someone probing), sensitive actions (key rotation,
 * backup restore), and dead webhook deliveries. The console renders this
 * live so the operator SEES who is knocking on the door.
 *
 * Design rules:
 *   - fire-and-forget: logging MUST never break or slow the request path
 *   - no secrets: type + severity + ip + short detail only, ever
 *   - bounded: keeps the newest 500 rows (pruned probabilistically)
 */

import { db } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

export type SecuritySeverity = "info" | "warn" | "critical";

export const SecurityEventType = {
  AUTH_OK: "auth_ok",
  AUTH_FAILED: "auth_failed",
  RATE_LIMITED: "rate_limited",
  SSRF_BLOCKED: "ssrf_blocked",
  KEY_ROTATED: "key_rotated",
  SECRETS_ENCRYPTED: "secrets_encrypted",
  WEBHOOKS_UPDATED: "webhooks_updated",
  BACKUP_CREATED: "backup_created",
  BACKUP_RESTORED: "backup_restored",
  LIGHTNING_UPDATED: "lightning_updated",
  SETUP_COMPLETED: "setup_completed",
  DELIVERY_DEAD: "delivery_dead",
  // console (human) auth — v0.5.0
  CONSOLE_LOGIN: "console_login",
  CONSOLE_LOGOUT: "console_logout",
  CONSOLE_LOCKED: "console_locked",
  CONSOLE_PASSWORD_SET: "console_password_set",
  CONSOLE_TOTP_ENABLED: "console_totp_enabled",
  CONSOLE_TOTP_DISABLED: "console_totp_disabled",
  LINK_CREATED: "link_created",
  LINK_CLAIMED: "link_claimed",
  LINK_CLAIM_FAILED: "link_claim_failed",
  SESSION_REVOKED: "session_revoked",
  STEP_UP_OK: "step_up_ok",
  STEP_UP_FAILED: "step_up_failed",
} as const;

const MAX_ROWS = 500;
const DETAIL_MAX = 300;

interface EventInput {
  type: string;
  severity?: SecuritySeverity;
  req?: Request;
  detail?: string;
}

export function logSecurityEvent({ type, severity = "info", req, detail }: EventInput): void {
  const ip = req ? clientIp(req) : "-";
  const ua = req ? (req.headers.get("user-agent") ?? "").slice(0, 180) : "";
  const safeDetail = (detail ?? "").slice(0, DETAIL_MAX);

  void (async () => {
    try {
      await db.securityEvent.create({
        data: { type, severity, ip, userAgent: ua, detail: safeDetail },
      });
      // probabilistic pruning keeps the table bounded without a cron
      if (Math.random() < 0.02) await pruneSecurityEvents();
    } catch {
      // never let monitoring break the monitored
    }
  })();
}

export async function pruneSecurityEvents(): Promise<void> {
  try {
    const count = await db.securityEvent.count();
    if (count <= MAX_ROWS) return;
    const oldest = await db.securityEvent.findMany({
      orderBy: { createdAt: "desc" },
      skip: MAX_ROWS,
      take: count - MAX_ROWS,
      select: { id: true },
    });
    if (oldest.length > 0) {
      await db.securityEvent.deleteMany({ where: { id: { in: oldest.map((r) => r.id) } } });
    }
  } catch {
    // ignore
  }
}
