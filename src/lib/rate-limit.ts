/**
 * Simple in-memory fixed-window rate limiter (per instance).
 * For Vercel serverless this limits per-lambda-instance — good enough to blunt
 * brute force / abuse; a Redis-backed limiter can be swapped in later.
 */

type Bucket = { count: number; resetAt: number };

const g = globalThis as unknown as { __librepayRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__librepayRate ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      // prune old entries to avoid unbounded growth
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { ok: true, retryAfter: 0 };
}

export function clientIp(req: Request): string {
  // Use the LAST hop: proxies we deploy behind (Caddy/nginx/Vercel) APPEND the
  // connecting address to x-forwarded-for, so the last entry is the one our
  // infrastructure observed. Taking the first element let clients spoof every
  // per-IP rate limit by prepending fake entries. Bracketed IPv6 is unwrapped.
  const pickLast = (v: string | null): string | null => {
    if (!v) return null;
    const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] ?? null;
    if (!last) return null;
    return last.replace(/^\[|\]$/g, "");
  };
  return (
    pickLast(req.headers.get("x-real-ip")) ||
    pickLast(req.headers.get("x-forwarded-for")) ||
    "unknown"
  );
}
