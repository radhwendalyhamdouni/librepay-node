/**
 * Operator console credential — the HUMAN login (BTCPay-style).
 *
 * The API key is the machine credential (shop → node). The console password is
 * the human credential. They never mix: the master key must not be typed into
 * a browser, and the password must never appear in an Authorization header.
 *
 * Storage (data/config.json, mode 0600):
 *   console.passwordHash = "scrypt$16384$8$1$<salt b64>$<hash b64>"  — no plaintext, ever
 *   console.totpEnc      = AES-256-GCM blob (encryptServerSecret) of the base32 secret
 *   console.totpConfirmed = true only after the first code verified (half-enabled 2FA
 *                           never gates a login)
 *   console.totpLastStep  = last consumed timestep (replay protection)
 *
 * Brute force: per-IP escalating lockout + one global bucket, both logged to
 * the SecurityEvent monitor so the operator SEES the knocking in real time.
 */

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { getSettings, saveSettings } from "@/lib/server/settings";
import { encryptServerSecret, decryptServerSecret, safeEqual } from "@/lib/server/crypto-server";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
export const PASSWORD_MIN = 10;

// ── password ────────────────────────────────────────────────────────────────

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw.normalize("NFKC"), salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(pw.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hasConsolePassword(): boolean {
  return !!getSettings().console.passwordHash;
}

/** Verify against the stored hash. Throws when no password exists (bootstrap not done). */
export function verifyConsolePassword(pw: string): boolean {
  const stored = getSettings().console.passwordHash;
  if (!stored) return false;
  return verifyPassword(pw, stored);
}

/** First set OR change (caller must already authenticate the operator). */
export function setConsolePassword(pw: string): void {
  if (pw.length < PASSWORD_MIN) throw new Error(`password too short — min ${PASSWORD_MIN}`);
  saveSettings({ console: { ...getSettings().console, passwordHash: hashPassword(pw) } });
}

export function clearConsolePassword(): void {
  saveSettings({ console: { passwordHash: null, totpEnc: null, totpConfirmed: false, totpLastStep: 0 } });
}

// ── TOTP (RFC 6238, SHA-1, 6 digits, 30s — Google Authenticator compatible) ─

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function b32encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

function totpSecret(): string | null {
  const enc = getSettings().console.totpEnc;
  if (!enc) return null;
  try {
    return decryptServerSecret(enc);
  } catch {
    return null;
  }
}

export function totpEnabled(): boolean {
  return getSettings().console.totpConfirmed && !!getSettings().console.totpEnc;
}

/**
 * Begin 2FA enrollment: generate a fresh secret, store it ENCRYPTED but
 * unconfirmed, and return the otpauth URI for the QR code. Login stays
 * password-only until totp-confirm verifies one real code.
 */
export function totpInit(storeName: string): { otpauthUri: string; secret: string } {
  const secret = b32encode(randomBytes(20));
  saveSettings({ console: { ...getSettings().console, totpEnc: encryptServerSecret(secret), totpConfirmed: false, totpLastStep: 0 } });
  const label = encodeURIComponent(`LibrePay Node:${storeName || "operator"}`);
  const issuer = encodeURIComponent("LibrePay Node");
  const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return { otpauthUri, secret };
}

export function totpCancel(): void {
  saveSettings({ console: { ...getSettings().console, totpEnc: null, totpConfirmed: false, totpLastStep: 0 } });
}

/** Verify a code against the UNCONFIRMED secret and activate 2FA. */
export function totpConfirm(code: string): boolean {
  const secret = totpSecret();
  if (!secret) return false;
  if (!consumeTotp(secret, code)) return false;
  saveSettings({ console: { ...getSettings().console, totpConfirmed: true } });
  return true;
}

/** Login-time verification — only when 2FA is fully enabled. Replay-protected. */
export function totpVerify(code: string): boolean {
  const secret = totpSecret();
  if (!secret || !getSettings().console.totpConfirmed) return false;
  return consumeTotp(secret, code);
}

function consumeTotp(secret: string, code: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const key = b32decode(secret);
  const step = Math.floor(Date.now() / 30_000);
  const lastUsed = getSettings().console.totpLastStep;
  for (let i = -1; i <= 1; i++) {
    const s = step + i;
    if (s <= lastUsed) continue; // replay / backwards-time guard
    const candidate = hotp(key, s);
    if (candidate.length === clean.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(clean))) {
      saveSettings({ console: { ...getSettings().console, totpLastStep: s } });
      return true;
    }
  }
  return false;
}

// ── brute-force lockout (in-memory, single-process by design) ───────────────

interface FailState {
  count: number;
  windowStart: number;
  lockedUntil: number;
  level: number; // lock duration doubles per locked window, capped
}

const g = globalThis as unknown as { __lpConsoleFails?: Map<string, FailState> };
const fails: Map<string, FailState> = (g.__lpConsoleFails ??= new Map());

const WINDOW_MS = 15 * 60_000; // 15 min failure window
const FAILS_ALLOWED = 5; // then first lock
const BASE_LOCK_MS = 15 * 60_000; // 15 min → 30 → 60 … capped at 24h
const MAX_LOCK_MS = 24 * 3600_000;
const GLOBAL_FAILS = 20; // distributed guessing guard

export interface LockStatus {
  locked: boolean;
  retryAfter: number; // seconds
}

function state(bucket: string): FailState {
  let s = fails.get(bucket);
  if (!s) {
    s = { count: 0, windowStart: Date.now(), lockedUntil: 0, level: 0 };
    fails.set(bucket, s);
  }
  return s;
}

function check(bucket: string, failsAllowed: number): LockStatus {
  const now = Date.now();
  const s = state(bucket);
  if (s.lockedUntil > now) return { locked: true, retryAfter: Math.ceil((s.lockedUntil - now) / 1000) };
  if (now - s.windowStart > WINDOW_MS) {
    s.count = 0;
    s.windowStart = now;
  }
  void failsAllowed;
  return { locked: false, retryAfter: 0 };
}

export function lockStatus(ip: string): LockStatus {
  const perIp = check(`ip:${ip}`, FAILS_ALLOWED);
  if (perIp.locked) return perIp;
  return check("global", GLOBAL_FAILS);
}

export function recordFailure(ip: string): void {
  const now = Date.now();
  for (const bucket of [`ip:${ip}`, "global"]) {
    const s = state(bucket);
    if (now - s.windowStart > WINDOW_MS) {
      s.count = 0;
      s.windowStart = now;
    }
    s.count++;
    const allowed = bucket === "global" ? GLOBAL_FAILS : FAILS_ALLOWED;
    if (s.count >= allowed && s.lockedUntil <= now) {
      const dur = Math.min(BASE_LOCK_MS * 2 ** s.level, MAX_LOCK_MS);
      s.lockedUntil = now + dur;
      s.level++;
      s.count = 0;
      s.windowStart = now;
    }
  }
}

export function recordSuccess(ip: string): void {
  fails.delete(`ip:${ip}`);
  // keep the global bucket: one clean login must not erase evidence of a
  // distributed attack still in progress
}

/** Test/debug visibility for the security monitor. */
export function lockSnapshot(): { ip: string; lockedUntil: number; level: number; count: number }[] {
  return [...fails.entries()].map(([ip, s]) => ({ ip, lockedUntil: s.lockedUntil, level: s.level, count: s.count }));
}

// re-export so routes can reuse
export { safeEqual };
