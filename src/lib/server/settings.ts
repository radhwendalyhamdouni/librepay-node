/**
 * LibrePay Node — operator settings layer.
 *
 * The node stays account-free: the operator IS a config file. This module
 * layers three sources (highest precedence first):
 *
 *   1. <dataDir>/config.json   — written by the first-run Setup Wizard / CLI
 *   2. environment (.env)      — classic deployment style
 *   3. built-in defaults
 *
 * Why a file: the Setup Wizard runs INSIDE the running node, so settings
 * must take effect without a restart and without a merchants table. The
 * file is read through an mtime-guarded cache — dynamic, cheap, correct.
 *
 * Secrets policy (unchanged principles):
 *   - the API key RAW value is shown ONCE by the wizard and only its
 *     sha256 is persisted (config.apiKeyHash)
 *   - the node NEVER holds a spending key: only watch-only zpub / payment code
 *   - SETUP_TOKEN exists only until first setup completes, then it is deleted
 */

import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { env, walletConfigured as envWalletConfigured } from "@/lib/env";
import { decryptServerSecret } from "@/lib/server/crypto-server";

export interface BackupSettings {
  enabled: boolean;
  intervalHours: number; // periodic schedule (embedded cron)
  retain: number; // keep last N archives on this server
  remoteTarget: string; // "user@host:/path" (scp/rsync over SSH) or ""
  remotePort: number; // ssh port for the remote target
  passphrase: string; // LEGACY plaintext (pre-v0.4 configs) — new writes use passphraseEnc
  passphraseEnc: string | null; // AES-256-GCM blob (encryptServerSecret) — encrypted at rest
}

export interface Settings {
  version: 1;
  setupComplete: boolean;
  storeName: string;
  brandColor: string;
  logoUrl: string | null;
  paymentCode: string | null;
  xpub: string | null;
  confirmationsRequired: number;
  invoiceExpiryMinutes: number;
  baseUrl: string; // public base URL for checkoutUrl ("" = derive from request)
  apiKeyHash: string | null; // sha256 of the raw lp_live_ key (never the raw)
  webhookUrls: string[];
  webhookSecrets: string[];
  /** Privacy posture chosen in the console:
   *  standard  — convenience first (Lightning first when available)
   *  balanced  — default: on-chain stealth rail + Lightning for small fast amounts
   *  maximum   — on-chain stealth/payment-code ONLY; Lightning off; everything self-hosted */
  privacyMode: "standard" | "balanced" | "maximum";
  lightning: { url: string | null; password: string | null; passwordEnc: string | null };
  backup: BackupSettings;
  createdAt: string;
  updatedAt: string;
}

function dataDir(): string {
  return process.env.LP_DATA_DIR || path.join(process.cwd(), "data");
}

function configPath(): string {
  return path.join(dataDir(), "config.json");
}

function setupTokenPath(): string {
  return path.join(dataDir(), "SETUP_TOKEN");
}

function defaults(): Settings {
  return {
    version: 1,
    setupComplete: false,
    storeName: env.STORE_NAME,
    brandColor: env.BRAND_COLOR,
    logoUrl: "/brand/logo-lockup.png",
    paymentCode: env.PAYMENT_CODE,
    xpub: env.XPUB,
    confirmationsRequired: env.CONFIRMATIONS_REQUIRED,
    invoiceExpiryMinutes: env.INVOICE_EXPIRY_MINUTES,
    baseUrl: env.BASE_URL,
    apiKeyHash: env.API_KEY ? createHash("sha256").update(env.API_KEY).digest("hex") : null,
    webhookUrls: env.WEBHOOK_URLS,
    webhookSecrets: env.WEBHOOK_SECRETS,
    privacyMode: "balanced",
    lightning: { url: env.LIGHTNING_URL, password: env.LIGHTNING_PASSWORD, passwordEnc: null },
    backup: {
      enabled: true,
      intervalHours: 24,
      retain: 14,
      remoteTarget: "",
      remotePort: 22,
      passphrase: "",
      passphraseEnc: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

let cache: { mtimeMs: number; value: Settings } | null = null;

/** Read settings with an mtime-guarded cache: dynamic without hammering the disk. */
export function getSettings(): Settings {
  const p = configPath();
  if (!existsSync(p)) return defaults();
  const mtime = statSync(p).mtimeMs;
  if (cache && cache.mtimeMs === mtime) return cache.value;
  let file: Partial<Settings> = {};
  try {
    file = JSON.parse(readFileSync(p, "utf8")) as Partial<Settings>;
  } catch {
    // corrupted config falls back to env/defaults rather than bricking the node
    file = {};
  }
  const d = defaults();
  const merged: Settings = {
    ...d,
    ...file,
    lightning: { ...d.lightning, ...(file.lightning ?? {}) },
    backup: { ...d.backup, ...(file.backup ?? {}) },
  };
  cache = { mtimeMs: mtime, value: merged };
  return merged;
}

/** Decrypted backup passphrase — passwordEnc wins, legacy plaintext tolerated for migration. */
export function resolveBackupPassphrase(s: Settings): string {
  if (s.backup.passphraseEnc) {
    try {
      return decryptServerSecret(s.backup.passphraseEnc);
    } catch {
      // key rotated / blob corrupted — fall through to legacy value
    }
  }
  return s.backup.passphrase ?? "";
}

/** Decrypted phoenixd password — env wins, then encrypted blob, then legacy plaintext. */
export function resolveLightningPassword(s: Settings): string | null {
  if (env.LIGHTNING_PASSWORD) return env.LIGHTNING_PASSWORD;
  if (s.lightning.passwordEnc) {
    try {
      return decryptServerSecret(s.lightning.passwordEnc);
    } catch {
      return null;
    }
  }
  return s.lightning.password ?? null;
}

/** Atomic write (tmp + rename) so a crash can never half-write config. */
export function saveSettings(patch: Partial<Settings>): Settings {
  mkdirSync(dataDir(), { recursive: true });
  const current = existsSync(configPath())
    ? (JSON.parse(readFileSync(configPath(), "utf8")) as Partial<Settings>)
    : {};
  const next: Settings = {
    ...defaults(),
    ...current,
    ...patch,
    lightning: { ...defaults().lightning, ...(current.lightning ?? {}), ...(patch.lightning ?? {}) },
    backup: { ...defaults().backup, ...(current.backup ?? {}), ...(patch.backup ?? {}) },
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  const tmp = configPath() + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, configPath());
  cache = null; // invalidate
  return next;
}

/** The node can receive money once a wallet rail exists. */
export function isConfigured(): boolean {
  const s = getSettings();
  return s.setupComplete || !!s.paymentCode || !!s.xpub;
}

/**
 * One-time setup token — proves the person completing setup has server
 * access (read data/SETUP_TOKEN). Deleted the moment setup completes, so
 * the window is closed forever; later changes require the API key.
 */
export function getSetupToken(): string {
  const p = setupTokenPath();
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const raw = randomBytes(8).toString("hex");
  const token = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(p, token + "\n", { mode: 0o600 });
  return token;
}

export function consumeSetupToken(): void {
  try {
    unlinkSync(setupTokenPath());
  } catch {
    /* already gone */
  }
}

export function verifySetupToken(candidate: string): boolean {
  const token = getSetupToken();
  const a = Buffer.from(createHash("sha256").update(candidate.trim()).digest("hex"));
  const b = Buffer.from(createHash("sha256").update(token).digest("hex"));
  return a.length === b.length && timingSafeEqual(a, b);
}

export { envWalletConfigured as walletConfigured };
export function dataDirPath(): string {
  return dataDir();
}
