/**
 * LibrePay Node — apply a staged restore.
 *
 *   npm run restore
 *
 * The Setup Wizard / API STAGES archive files into data/restore-pending/
 * while the node keeps running. This command applies them safely:
 *   1. snapshot the CURRENT config.json + database  (data/pre-restore/)
 *   2. copy the staged database to the path DATABASE_URL points at
 *   3. replace data/config.json (+ .env if the archive carries one)
 *   4. print the restart instruction
 *
 * Nothing is deleted — every replaced file survives in data/pre-restore/.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const DATA = process.env.LP_DATA_DIR || path.join(process.cwd(), "data");
const STAGE = path.join(DATA, "restore-pending");

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!existsSync(path.join(STAGE, "manifest.json"))) {
  fail("no staged restore found (data/restore-pending/manifest.json missing)");
}

const manifest = JSON.parse(readFileSync(path.join(STAGE, "manifest.json"), "utf8"));
console.log(`LibrePay Node restore — source: ${manifest.source}`);
console.log(`staged at: ${manifest.stagedAt}\n`);

const pre = path.join(DATA, `pre-restore-${Date.now()}`);
mkdirSync(pre, { recursive: true });

// 1. snapshot current state
const currentConfig = path.join(DATA, "config.json");
if (existsSync(currentConfig)) {
  copyFileSync(currentConfig, path.join(pre, "config.json"));
  console.log(`✓ current config.json  → ${path.basename(pre)}/`);
}

// resolve the live database path exactly like prisma does (env > default)
let dbUrl = process.env.DATABASE_URL ?? "";
const envPath = path.join(process.cwd(), ".env");
if (!dbUrl && existsSync(envPath)) {
  dbUrl = /DATABASE_URL=(\S+)/.exec(readFileSync(envPath, "utf8"))?.[1] ?? "";
}
const dbFile = dbUrl.startsWith("file:")
  ? path.resolve(process.cwd(), dbUrl.slice(5))
  : path.join(DATA, "node.db");

if (existsSync(dbFile)) {
  copyFileSync(dbFile, path.join(pre, path.basename(dbFile)));
  console.log(`✓ current database     → ${path.basename(pre)}/`);
}

// 2. restore the database
copyFileSync(path.join(STAGE, "database.db"), dbFile);
console.log(`✓ database restored    → ${dbFile}`);

// 3. restore config.json
copyFileSync(path.join(STAGE, "config.json"), currentConfig);
console.log("✓ config.json restored");

// 4. .env, if the archive carries one — never silently destroy the current
if (manifest.files.includes("env.txt")) {
  if (existsSync(envPath)) renameSync(envPath, path.join(pre, ".env"));
  writeFileSync(envPath, readFileSync(path.join(STAGE, "env.txt")), { mode: 0o600 });
  console.log("✓ .env restored (previous kept in pre-restore snapshot)");
}

console.log(`
════════════════════════════════════════════════
  Restore applied. Restart the node to go live:

    sudo systemctl restart librepay-node   (systemd)
    — or —
    npm run start

  Rollback anytime: everything replaced was kept
  in ${path.basename(pre)}/
════════════════════════════════════════════════`);
