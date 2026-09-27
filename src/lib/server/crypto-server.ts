/**
 * Server-side secret encryption (AES-256-GCM).
 * Used for merchant Lightning credentials (phoenixd http-password).
 *
 * Key derivation: HKDF-SHA256 over the app secret (NEXTAUTH_SECRET) with a
 * fixed salt + context string, so rotating NEXTAUTH_SECRET invalidates stored
 * credentials (acceptable: merchants can re-connect in one step).
 */

import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { env } from "@/lib/env";

const HKDF_SALT = "librepay-server-cred-v1";
const HKDF_INFO = "librepay:lightning-credentials";

// Fail closed lazily: in production a missing LP_APP_SECRET must abort at
// first USE, not at build time (page-data collection imports this module).
export function appSecret(): string {
  if (env.NODE_ENV === "production" && !env.APP_SECRET) {
    throw new Error("LP_APP_SECRET must be set in production");
  }
  return env.APP_SECRET ?? "librepay-node-dev-secret-do-not-use-in-production";
}

/** Length-safe, timing-safe string comparison (hash both sides first). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** HKDF-Extract + Expand (RFC 5869) with SHA-256. */
function hkdf(ikm: string, salt: string, info: string, length = 32): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  let t = Buffer.alloc(0);
  const okm: Buffer[] = [];
  let counter = 1;
  while (Buffer.concat(okm).length < length) {
    t = createHmac("sha256", prk).update(Buffer.concat([t, Buffer.from(info), Buffer.from([counter])])).digest();
    okm.push(t);
    counter++;
  }
  return Buffer.concat(okm).subarray(0, length);
}

function key(): Buffer {
  return hkdf(appSecret(), HKDF_SALT, HKDF_INFO, 32);
}

export interface ServerEncrypted {
  v: 1;
  iv: string; // base64
  ct: string; // base64
}

export function encryptServerSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    ct: Buffer.concat([tag, ct]).toString("base64"),
  } satisfies ServerEncrypted);
}

export function decryptServerSecret(blob: string): string {
  const parsed = JSON.parse(blob) as ServerEncrypted;
  if (parsed.v !== 1) throw new Error("unsupported_blob_version");
  const data = Buffer.from(parsed.ct, "base64");
  const tag = data.subarray(0, 16);
  const ct = data.subarray(16);
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
