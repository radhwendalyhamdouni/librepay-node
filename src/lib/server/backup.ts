/**
 * LibrePay Node — encrypted backups, local retention, off-server push.
 *
 * What goes into an archive (.lplbackup):
 *   - a consistent SQLite snapshot (VACUUM INTO — safe on a live db)
 *   - data/config.json (operator settings; API key is stored as sha256 only)
 *   - .env, if present (contains the raw API key + phoenixd password —
 *     so ALWAYS encrypt when pushing off-server)
 *
 * At-rest encryption: AES-256-GCM, key = scrypt(passphrase). When the
 * operator sets a backup passphrase, archives are unreadable without it —
 * safe to keep on any external server. In-transit: scp/rsync over SSH,
 * or HTTPS for downloads.
 *
 * Restore is intentionally two-step and honest: this module STAGES files
 * into data/restore-pending/, and `npm run restore` applies them with a
 * pre-restore snapshot taken first. A restart applies the restored state.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { dataDirPath, getSettings } from "@/lib/server/settings";

const MAGIC = "LPLBACKUP1";
const ARCHIVE_RE = /^[A-Za-z0-9._-]+\.lplbackup$/;

export interface BackupState {
  lastBackupAt: string | null;
  lastRemotePushAt: string | null;
  lastRemoteError: string | null;
}

export function backupDir(): string {
  return path.join(dataDirPath(), "backups");
}

function statePath(): string {
  return path.join(dataDirPath(), "backup-state.json");
}

function readState(): BackupState {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as BackupState;
  } catch {
    return { lastBackupAt: null, lastRemotePushAt: null, lastRemoteError: null };
  }
}

function writeState(s: BackupState): void {
  mkdirSync(dataDirPath(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** Consistent, online-safe SQLite snapshot via VACUUM INTO. */
async function snapshotDb(target: string): Promise<void> {
  // path is generated internally (safe characters only) — no user input
  await db.$queryRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "")}'`);
}

export async function createBackup(reason: "manual" | "scheduled" | "pre-restore"): Promise<{
  name: string;
  bytes: number;
  encrypted: boolean;
}> {
  const settings = getSettings();
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmpDb = path.join(dir, `.snapshot-${stamp}.db`);
  await snapshotDb(tmpDb);

  const envPath = path.join(process.cwd(), ".env");
  const configPath = path.join(dataDirPath(), "config.json");
  // env-configured nodes may never have run the wizard — embed live settings
  const configContent = existsSync(configPath)
    ? readFileSync(configPath, "utf8")
    : JSON.stringify(getSettings(), null, 2);
  const payload = {
    magic: MAGIC,
    meta: {
      app: "librepay-node",
      createdAt: new Date().toISOString(),
      reason,
      encrypted: !!settings.backup.passphrase,
      includesEnv: existsSync(envPath),
    },
    config: JSON.parse(configContent),
    envText: existsSync(envPath) ? readFileSync(envPath, "utf8") : null,
    dbB64: readFileSync(tmpDb).toString("base64"),
  };
  rmSync(tmpDb, { force: true });

  const gz = gzipSync(Buffer.from(JSON.stringify(payload)));

  let out = gz;
  if (settings.backup.passphrase) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveKey(settings.backup.passphrase, salt), iv);
    const enc = Buffer.concat([cipher.update(gz), cipher.final()]);
    out = Buffer.concat([Buffer.from("ENCV1"), salt, iv, cipher.getAuthTag(), enc]);
  }

  const name = `librepay-node-${stamp}.lplbackup`;
  writeFileSync(path.join(dir, name), out, { mode: 0o600 });

  // retention — keep the newest N
  const keep = Math.max(1, settings.backup.retain);
  const all = listBackups().sort((a, b) => (a.name < b.name ? 1 : -1));
  for (const old of all.slice(keep)) {
    rmSync(path.join(dir, old.name), { force: true });
  }

  const state = readState();
  state.lastBackupAt = payload.meta.createdAt;
  writeState(state);

  return { name, bytes: out.length, encrypted: !!settings.backup.passphrase };
}

export function listBackups(): { name: string; bytes: number; mtime: string }[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => ARCHIVE_RE.test(f))
    .map((name) => {
      const st = statSync(path.join(dir, name));
      return { name, bytes: st.size, mtime: st.mtime.toISOString() };
    });
}

/** Decode an archive (decrypt if the operator set a passphrase). */
function decodeArchive(buf: Buffer): ReturnType<typeof JSON.parse> {
  let gz: Buffer;
  if (buf.subarray(0, 5).toString() === "ENCV1") {
    const passphrase = getSettings().backup.passphrase;
    if (!passphrase) throw new Error("archive is encrypted but no backup passphrase is configured");
    const salt = buf.subarray(5, 21);
    const iv = buf.subarray(21, 33);
    const tag = buf.subarray(33, 49);
    const data = buf.subarray(49);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    gz = Buffer.concat([decipher.update(data), decipher.final()]);
  } else {
    gz = buf;
  }
  const payload = JSON.parse(gunzipSync(gz).toString("utf8"));
  if (payload?.magic !== MAGIC) throw new Error("not a librepay-node backup");
  return payload;
}

export function readBackupFile(name: string): Buffer {
  if (!ARCHIVE_RE.test(name)) throw new Error("invalid backup name");
  const p = path.join(backupDir(), name);
  if (!existsSync(p)) throw new Error("backup not found");
  return readFileSync(p);
}

/** Stage a restore — applied later by `npm run restore` + restart. */
export function stageRestore(name: string): { stagedAt: string; files: string[] } {
  const payload = decodeArchive(readBackupFile(name));
  const stage = path.join(dataDirPath(), "restore-pending");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  writeFileSync(path.join(stage, "config.json"), JSON.stringify(payload.config, null, 2), { mode: 0o600 });
  const files = ["config.json"];
  if (payload.envText) {
    writeFileSync(path.join(stage, "env.txt"), payload.envText, { mode: 0o600 });
    files.push("env.txt");
  }
  writeFileSync(path.join(stage, "database.db"), Buffer.from(payload.dbB64, "base64"));
  files.push("database.db");

  const manifest = {
    source: name,
    stagedAt: new Date().toISOString(),
    files,
    nextStep: "npm run restore  (then restart the node)",
  };
  writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}

/** Decode a freshly uploaded archive and stage it the same way. */
export function stageRestoreFromUpload(bytes: Buffer, filename: string): ReturnType<typeof stageRestore> {
  if (!ARCHIVE_RE.test(filename)) throw new Error("file must be named *.lplbackup");
  decodeArchive(bytes); // validate before staging
  mkdirSync(backupDir(), { recursive: true });
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "");
  const p = path.join(backupDir(), safe);
  if (existsSync(p)) throw new Error("a backup with this name already exists");
  writeFileSync(p, bytes, { mode: 0o600 });
  return stageRestore(safe);
}

/** Push the newest archive to the operator's off-server SSH target. */
export function pushRemote(): Promise<{ ok: boolean; target: string; error?: string }> {
  const settings = getSettings();
  const target = settings.backup.remoteTarget.trim();
  const state = readState();
  if (!target) return Promise.resolve({ ok: false, target: "", error: "no remote target configured" });

  const all = listBackups().sort((a, b) => (a.name < b.name ? 1 : -1));
  if (!all.length) return Promise.resolve({ ok: false, target, error: "no backups to push" });
  const file = path.join(backupDir(), all[0].name);
  const port = String(settings.backup.remotePort || 22);

  return new Promise((resolve) => {
    // args array — no shell, nothing user-controlled is ever interpreted
    const child = spawn("scp", ["-P", port, "-o", "StrictHostKeyChecking=accept-new", file, target], {
      stdio: "ignore",
      timeout: 120_000,
    });
    child.on("error", (err) => {
      state.lastRemoteError = err.message;
      writeState(state);
      resolve({ ok: false, target, error: err.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        state.lastRemotePushAt = new Date().toISOString();
        state.lastRemoteError = null;
      } else {
        state.lastRemoteError = `scp exited with code ${code}`;
      }
      writeState(state);
      resolve({ ok: code === 0, target, error: code === 0 ? undefined : state.lastRemoteError ?? undefined });
    });
  });
}

/** Embedded-cron hook: run a scheduled backup when the interval elapsed. */
export async function maybeBackup(): Promise<void> {
  const settings = getSettings();
  if (!settings.backup.enabled || !isNodeConfigured()) return;
  const state = readState();
  const last = state.lastBackupAt ? Date.parse(state.lastBackupAt) : 0;
  const due = Date.now() - last >= settings.backup.intervalHours * 3_600_000;
  if (!due) return;
  const r = await createBackup("scheduled");
  if (settings.backup.remoteTarget) await pushRemote();
  console.log(`[backup] scheduled archive ${r.name} (${Math.round(r.bytes / 1024)} KB)`);
}

function isNodeConfigured(): boolean {
  const s = getSettings();
  return s.setupComplete || !!s.paymentCode || !!s.xpub;
}

export function backupStatus(): BackupState & { count: number; totalBytes: number; encrypted: boolean } {
  const state = readState();
  const all = listBackups();
  return {
    ...state,
    count: all.length,
    totalBytes: all.reduce((n, b) => n + b.bytes, 0),
    encrypted: !!getSettings().backup.passphrase,
  };
}

/** Cheap integrity probe used by /api/system/status. */
export function backupHealthHash(): string {
  return createHash("sha256").update(String(backupStatus().count)).digest("hex").slice(0, 8);
}
