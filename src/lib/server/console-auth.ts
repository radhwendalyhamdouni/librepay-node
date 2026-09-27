/**
 * Operator console sessions — "the easier & more guaranteed way in", done the
 * BTCPay way: the HUMAN credential (password + optional TOTP) opens a session;
 * the MACHINE credential (lp_live_ API key) belongs to the shop integration.
 *
 *   login (password + TOTP)      → POST /api/console/login
 *   first-run (API key → set pw) → POST /api/console/bootstrap
 *   recovery (server access)     → bun run console:link → GET /api/console/claim?token=…
 *
 * All three mint the same artifact: an HTTP-only session cookie.
 *
 * Cookie hardening:
 *   HttpOnly     — JavaScript can never read it (XSS-safe)
 *   SameSite=Lax — never sent on cross-site requests (CSRF-safe for POST/PUT)
 *   Secure       — only over https hops (auto-detected from forwarded proto)
 *   sliding TTL  — 8h by default, 30d with "trust this device", renewed on use
 *   revocable    — server-side rows in SQLite; the console lists & kills them
 *
 * Step-up: a stolen cookie can READ, but rotating the API key, changing
 * webhook destinations (payment-redirection!), restoring backups, changing
 * credentials or connecting Lightning re-asks the password (5-minute window).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";
import { authenticateApiKey, hashApiKey } from "@/lib/server/api-auth";
import { getSettings } from "@/lib/server/settings";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "lp_node_console";
const SESSION_TTL_SHORT_MS = 8 * 3600_000; // 8 hours
const SESSION_TTL_TRUSTED_MS = 30 * 24 * 3600_000; // 30 days ("trust this device")
const TOUCH_INTERVAL_MS = 5 * 60_000; // write-throttle for lastSeenAt
const STEP_UP_WINDOW_MS = 5 * 60_000; // password re-confirmation freshness
const TOKEN_BYTES = 32;

export type SessionMethod = "password" | "link" | "firstrun";

export interface ConsoleSessionInfo {
  id: string;
  method: SessionMethod;
  ip: string;
  userAgent: string;
  trusted: boolean;
  stepUpAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function randomToken(): string {
  const b = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

// ── cookie ──────────────────────────────────────────────────────────────────

export function sessionCookieHeader(token: string, req: Request, trusted: boolean): string {
  const xf = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const https = xf === "https" || new URL(req.url).protocol === "https:";
  const ttlS = Math.floor((trusted ? SESSION_TTL_TRUSTED_MS : SESSION_TTL_SHORT_MS) / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlS}${https ? "; Secure" : ""}`;
}

export function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// ── sessions ────────────────────────────────────────────────────────────────

export async function createConsoleSession(method: SessionMethod, req: Request, trusted = false): Promise<string> {
  const token = randomToken();
  await db.consoleSession.create({
    data: {
      tokenHash: sha256(token),
      method,
      trusted,
      ip: clientIp(req),
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 180),
      expiresAt: new Date(Date.now() + (trusted ? SESSION_TTL_TRUSTED_MS : SESSION_TTL_SHORT_MS)),
    },
  });
  return token;
}

/** Resolve the cookie to a live session. Sliding renewal with throttled writes. */
export async function resolveConsoleSession(req: Request): Promise<ConsoleSessionInfo | null> {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw || raw.length < 20) return null;
  const row = await db.consoleSession.findUnique({ where: { tokenHash: sha256(raw) } }).catch(() => null);
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;

  const now = Date.now();
  if (now - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    const ttl = row.trusted ? SESSION_TTL_TRUSTED_MS : SESSION_TTL_SHORT_MS;
    await db.consoleSession
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + ttl) } })
      .catch(() => {});
  }
  return {
    id: row.id,
    method: (row.method as SessionMethod) ?? "password",
    ip: row.ip,
    userAgent: row.userAgent,
    trusted: row.trusted,
    stepUpAt: row.stepUpAt,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  };
}

export type ConsoleAuth =
  | { method: "session"; session: ConsoleSessionInfo }
  | { method: "key" };

/**
 * Console authentication: session cookie FIRST (the human path), classic
 * Bearer API key SECOND (kept for curl/automation — never shown in the UI).
 */
export async function authenticateConsole(req: Request): Promise<ConsoleAuth | null> {
  const session = await resolveConsoleSession(req);
  if (session) return { method: "session", session };
  if (await authenticateApiKey(req)) return { method: "key" };
  return null;
}

/** True when the session recently re-confirmed the password (step-up window). */
export function stepUpFresh(session: ConsoleSessionInfo): boolean {
  return !!session.stepUpAt && Date.now() - session.stepUpAt.getTime() <= STEP_UP_WINDOW_MS;
}

/**
 * Sensitive-action gate. Sessions must hold a fresh password confirmation;
 * Bearer-key callers already possess the master secret and pass through.
 */
export function stepUpSatisfied(auth: ConsoleAuth): boolean {
  if (auth.method === "key") return true;
  return stepUpFresh(auth.session);
}

export const STEP_UP_REQUIRED = { error: "STEP_UP_REQUIRED", detail: "re-enter your console password to continue" } as const;

// ── one-time recovery links ─────────────────────────────────────────────────

export async function createLinkToken(hours: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + Math.min(Math.max(hours, 0.1), 24 * 14) * 3600_000);
  await db.consoleLinkToken.create({ data: { tokenHash: sha256(token), expiresAt } });
  logSecurityEvent({
    type: SecurityEventType.LINK_CREATED,
    detail: `one-time console recovery link minted (valid ${((expiresAt.getTime() - Date.now()) / 3600_000).toFixed(1)}h)`,
  });
  return { token, expiresAt };
}

export type ClaimResult =
  | { ok: true; sessionToken: string; trusted: boolean }
  | { ok: false; reason: "invalid" | "used" | "expired" | "rate" };

/** One-time atomic claim → session. Recovery links trust the device (30d). */
export async function claimLinkToken(raw: string, req: Request): Promise<ClaimResult> {
  const ip = clientIp(req);
  if (!rateLimit(`linkclaim:${ip}`, 20, 15 * 60_000).ok) {
    logSecurityEvent({ type: SecurityEventType.RATE_LIMITED, severity: "warn", req, detail: "link claim throttle tripped" });
    return { ok: false, reason: "rate" };
  }
  const row = await db.consoleLinkToken.findUnique({ where: { tokenHash: sha256(raw) } }).catch(() => null);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const claimed = await db.consoleLinkToken
    .updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date(), usedIp: ip } });
  if (claimed.count === 0) return { ok: false, reason: "used" };

  const sessionToken = await createConsoleSession("link", req, true);
  logSecurityEvent({ type: SecurityEventType.LINK_CLAIMED, req, detail: "recovery link consumed — console session opened" });
  return { ok: true, sessionToken, trusted: true };
}

// ── session administration ──────────────────────────────────────────────────

export async function listActiveSessions() {
  const rows = await db.consoleSession.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    ip: r.ip,
    userAgent: r.userAgent,
    trusted: r.trusted,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }));
}

export async function revokeSession(id: string): Promise<boolean> {
  const r = await db.consoleSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count > 0;
}

export async function revokeAllSessions(exceptId?: string): Promise<number> {
  const r = await db.consoleSession.updateMany({
    where: { revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

/** Housekeeping for expired/revoked rows (CLI + probabilistic call sites). */
export async function pruneConsoleRows(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000);
  await db.consoleSession.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } }).catch(() => {});
  await db.consoleLinkToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }).catch(() => {});
}

// ── operator key check (bootstrap path) ─────────────────────────────────────

/** Timing-safe check of a raw lp_live_ key against config hash + env. */
export function verifyOperatorKey(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^lp_live_[a-f0-9]{48}$/.test(trimmed)) return false;
  const presented = Buffer.from(hashApiKey(trimmed));
  const configHash = getSettings().apiKeyHash;
  const candidates = [configHash, env.API_KEY ? hashApiKey(env.API_KEY) : null].filter(
    (h): h is string => typeof h === "string"
  );
  return candidates.some((expected) => {
    const b = Buffer.from(expected);
    return presented.length === b.length && timingSafeEqual(presented, b);
  });
}
