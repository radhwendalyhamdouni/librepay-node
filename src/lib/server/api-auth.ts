/**
 * API-key authentication for the public merchant API (v1).
 *
 * LibrePay Node edition: ONE operator key — set by `bun run setup` (env
 * LP_API_KEY) or by the first-run Setup Wizard (persisted as sha256 in
 * data/config.json). Format: lp_live_<48 hex>. Compared timing-safe against
 * its sha256 — the raw key never appears in logs or on disk.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/server/settings";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Generate an operator key in the platform format: lp_live_ + 48 hex chars. */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const raw = `lp_live_${hex}`;
  return { raw, prefix: raw.slice(0, 12), hash: hashApiKey(raw) };
}

const KEY_RE = /^Bearer\s+(lp_live_[a-f0-9]{48})$/i;

export async function authenticateApiKey(req: Request): Promise<{ merchantId: string; keyId: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = KEY_RE.exec(auth.trim());
  if (!m) {
    // malformed / missing key — only worth logging when someone bothered to send one
    if (auth.trim().length > 0) {
      logSecurityEvent({
        type: SecurityEventType.AUTH_FAILED,
        severity: "warn",
        req,
        detail: "malformed authorization header",
      });
    }
    return null;
  }
  // Throttle DB-less lookups against key-guessing / hammering clients.
  if (!rateLimit(`apikeylookup:${clientIp(req)}`, 60, 60_000).ok) {
    logSecurityEvent({
      type: SecurityEventType.RATE_LIMITED,
      severity: "warn",
      req,
      detail: "key lookup throttle tripped (possible brute force)",
    });
    return null;
  }
  const presented = Buffer.from(hashApiKey(m[1]));
  // hash sources: Setup Wizard config (preferred), then classic .env
  const configHash = getSettings().apiKeyHash;
  const candidates = [configHash, env.API_KEY ? hashApiKey(env.API_KEY) : null].filter(
    (h): h is string => typeof h === "string"
  );
  for (const expected of candidates) {
    const b = Buffer.from(expected);
    if (presented.length === b.length && timingSafeEqual(presented, b)) {
      logSecurityEvent({ type: SecurityEventType.AUTH_OK, req, detail: "api key accepted" });
      return { merchantId: "self", keyId: configHash ? "config" : "env" };
    }
  }
  logSecurityEvent({
    type: SecurityEventType.AUTH_FAILED,
    severity: "warn",
    req,
    detail: `wrong lp_live_ key (sha256 ${hashApiKey(m[1]).slice(0, 8)}…)`,
  });
  return null;
}
