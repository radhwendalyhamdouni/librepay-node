/**
 * LibrePay Node — operator console administration (run on the server).
 *
 *   bun run console:link [--hours 24] [--base https://node.example.com]
 *       Mint a ONE-TIME recovery login link. Opening it in any browser opens
 *       a trusted 30-day console session. Use when you lost the password or
 *       are on a new device. Server access IS the proof of ownership.
 *
 *   bun run console:revoke-all
 *       Kill every active console session (e.g. a device was stolen).
 *
 *   bun run console:reset-password
 *       Erase the console password + 2FA. The next /setup visit will ask for
 *       the operator API key once (bootstrap) to create new credentials.
 */

import { createLinkToken, revokeAllSessions, pruneConsoleRows } from "../src/lib/server/console-auth";
import { clearConsolePassword, hasConsolePassword } from "../src/lib/server/console-credential";
import { logSecurityEvent, SecurityEventType } from "../src/lib/server/audit";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

function header(t: string) {
  console.log(`\n── ${t} ${"─".repeat(Math.max(3, 58 - t.length))}`);
}

async function main() {
  await pruneConsoleRows();

  if (has("--revoke-all")) {
    const n = await revokeAllSessions();
    header("sessions revoked");
    console.log(`✓ closed ${n} active console session(s) — every device must log in again`);
    console.log("  (the console password and 2FA are untouched)");
    await flush();
    return;
  }

  if (has("--reset-password")) {
    if (!hasConsolePassword()) {
      console.log("no console password is set — nothing to reset");
      await flush();
      return;
    }
    clearConsolePassword();
    const n = await revokeAllSessions();
    logSecurityEvent({
      type: SecurityEventType.CONSOLE_PASSWORD_SET,
      severity: "critical",
      detail: `console password + 2FA erased from the server CLI — bootstrap required (${n} session(s) revoked)`,
    });
    header("password reset");
    console.log("✓ console password and 2FA erased");
    console.log(`✓ ${n} console session(s) revoked — every device must re-bootstrap`);
    console.log("  open /setup → paste the operator API key once → create new credentials");
    await flush();
    return;
  }

  // default: mint a one-time recovery link
  const hours = Number(arg("--hours") ?? "24");
  // NOTE: || (not ??) — an EMPTY LP_BASE_URL= in .env must fall through to localhost
  const base = (arg("--base") || process.env.LP_BASE_URL || `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
  const { token, expiresAt } = await createLinkToken(hours);
  const url = `${base}/api/console/claim?token=${token}`;

  header("one-time console login link");
  console.log(url);
  console.log(`\n• valid until ${expiresAt.toISOString()} (${hours}h) — works ONCE`);
  console.log("• opening it signs that browser in for 30 days (trusted device)");
  console.log("• anyone with this URL can open your console — share it like a password");
  console.log(`• revoke everything later: bun run console:revoke-all`);
  await flush();
}

/** Give the fire-and-forget audit writer a moment, then exit cleanly. */
async function flush() {
  await new Promise((r) => setTimeout(r, 250));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
