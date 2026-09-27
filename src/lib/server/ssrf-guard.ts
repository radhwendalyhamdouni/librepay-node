/**
 * SSRF guard — outbound URL policy for URLs that originate from users
 * (merchant webhook endpoints, merchant phoenixd nodes).
 *
 * Defense layers:
 *   1. Protocol allowlist (https; http only for explicit local dev).
 *   2. Hostname blocklist: localhost variants, IP-literal private/reserved
 *      ranges (IPv4 + IPv6), cloud metadata endpoints, .internal/.local.
 *   3. No credentials in URL, no fragments.
 *
 * DNS-rebinding note: full protection would require pinning resolved IPs at
 * connect time, which Node's fetch does not expose. For the two call sites
 * here the risk is mitigated by: (a) webhook secrets are HMAC-signed with a
 * per-merchant secret so an attacker who reaches internal services still
 * cannot forge valid payloads; (b) phoenixd URLs are credential-bearing and
 * validated by a live /getinfo handshake.
 */

import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".corp", ".localdomain"];

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function isReservedIPv4(ip: string): boolean {
  // expand shorthand (e.g. 127.1)
  const long = ipv4ToLong(ip);
  if (long === null) {
    // possible shorthand like 10.1 — reject conservatively
    if (/^\d+(\.\d+)+$/.test(ip)) return true;
    return false;
  }
  if (long === 0) return true; // 0.0.0.0/8
  if (long >>> 24 === 10) return true; // 10/8
  if (long >>> 20 === 0xac1) return true; // 172.16/12 (172.16–172.31)
  if (long >>> 16 === 0xc0a8) return true; // 192.168/16
  if (long >>> 16 === 0xa9fe) return true; // 169.254/16 link-local + metadata
  if (long >>> 24 === 127) return true; // loopback
  if (long >>> 28 === 0xe) return true; // multicast 224/4
  if (long >>> 24 === 100 && (long >>> 16 & 0xff) >= 64 && (long >>> 16 & 0xff) <= 127) return true; // CGNAT 100.64/10
  if (long >= 0xf0000000) return true; // 240/4 reserved + broadcast
  if (long >>> 24 === 198 && (long >>> 16 & 0xff) === 18) return true; // 198.18/15 benchmark
  return false;
}

function isReservedIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local fc00::/7
  if (h.startsWith("::ffff:")) {
    // IPv4-mapped
    const v4 = h.slice(7);
    if (v4.includes(".")) return isReservedIPv4(v4);
  }
  return false;
}

export interface GuardedUrl {
  ok: true;
  url: URL;
}
export interface GuardedUrlError {
  ok: false;
  reason: string;
}

export function guardOutboundUrl(raw: string, opts?: { allowInsecureDev?: boolean }): GuardedUrl | GuardedUrlError {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  if (url.hash) return { ok: false, reason: "fragment_not_allowed" };

  const isLocalDev = url.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(url.hostname);
  if (isLocalDev) {
    if (opts?.allowInsecureDev) return { ok: true, url };
    return { ok: false, reason: "https_required" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "https_required" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: "blocked_host" };
  for (const suf of BLOCKED_SUFFIXES) {
    if (host.endsWith(suf)) return { ok: false, reason: "blocked_host" };
  }
  // cloud metadata by IP
  if (/^169\.254/.test(host) || host === "100.100.100.200") return { ok: false, reason: "blocked_host" };

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || /^\d+(\.\d+)+$/.test(host)) {
    if (isReservedIPv4(host)) return { ok: false, reason: "reserved_ip" };
  }
  if (host.includes(":") || host.startsWith("[")) {
    if (isReservedIPv6(host)) return { ok: false, reason: "reserved_ip" };
  }
  // decimal/octal/hex IP obfuscation (e.g. 2130706433, 0x7f000001)
  if (/^(0x[0-9a-f]+|\d{8,})$/.test(host)) return { ok: false, reason: "obfuscated_ip" };

  return { ok: true, url };
}

/** Public reason → user-safe message key mapping is done at the call site. */
export function assertOutboundUrl(raw: string, opts?: { allowInsecureDev?: boolean }): URL {
  const g = guardOutboundUrl(raw, opts);
  if (!g.ok) {
    // security monitor: someone (or a bad config) tried to reach a protected target
    logSecurityEvent({
      type: SecurityEventType.SSRF_BLOCKED,
      severity: "warn",
      detail: `${g.reason} ← ${raw.slice(0, 200)}`,
    });
    throw new Error(g.reason);
  }
  return g.url;
}
