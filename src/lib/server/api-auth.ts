/**
 * API-key authentication for the public merchant API (v1).
 *
 * LibrePay Node edition: ONE operator key lives in .env (LP_API_KEY), generated
 * by `bun run setup` in the exact platform format lp_live_<48 hex>. Compared
 * timing-safe against its sha256 — the raw key never appears in logs.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";

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
  if (!m || !env.API_KEY) return null;
  // Throttle DB-less lookups against key-guessing / hammering clients.
  if (!rateLimit(`apikeylookup:${clientIp(req)}`, 60, 60_000).ok) return null;
  const a = Buffer.from(hashApiKey(m[1]));
  const b = Buffer.from(hashApiKey(env.API_KEY));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { merchantId: "self", keyId: "env" };
}
