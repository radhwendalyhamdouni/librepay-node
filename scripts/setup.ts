/**
 * LibrePay Node — one-time setup.
 *
 *   bun run setup
 *
 * Generates the operator secrets and prints a ready-to-paste .env block.
 * With a wallet already configured it also derives the first address as a
 * sanity check that the node sees the SAME wallet you do.
 */

import { generateApiKey } from "../src/lib/server/api-auth";
import { deriveWatchOnlyAddress, deriveInvoiceAddress } from "../src/lib/server/derive";
import { env } from "../src/lib/env";
import { hrpFor } from "../src/lib/network";

function hex(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function header(t: string) {
  console.log(`\n── ${t} ${"─".repeat(Math.max(3, 58 - t.length))}`);
}

async function main() {
  console.log("LibrePay Node setup");
  console.log("===================");

  const key = generateApiKey();
  const appSecret = hex(32);
  const webhookSecret = hex(32);

  header("paste into .env");
  console.log(`LP_API_KEY=${key.raw}`);
  console.log(`LP_APP_SECRET=${appSecret}`);
  console.log(`LP_WEBHOOK_SECRETS=${webhookSecret}`);

  header("keep private");
  console.log("• the API key is shown ONCE — store it in your password manager");
  console.log("• never commit .env; never paste these into chat/issues");

  const payCode = process.env.LP_PAYMENT_CODE;
  const xpub = process.env.LP_ZPUB ?? process.env.LP_XPUB;

  header("wallet check");
  const hrp = hrpFor(env.NETWORK);
  try {
    if (payCode) {
      const d = deriveInvoiceAddress(payCode, hrp);
      console.log(`payment code OK → first stealth address: ${d.address}`);
    } else if (xpub) {
      const d = deriveWatchOnlyAddress(xpub, 0, hrp);
      console.log(`zpub/vpub OK → first watch-only address (m/0/0): ${d.address}`);
    } else {
      console.log("⚠ no wallet configured yet — set LP_PAYMENT_CODE or LP_ZPUB");
      console.log("  the rail stays DARK (invoices refused) until then. by design.");
    }
  } catch (e) {
    console.error("✗ wallet check failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  header("next steps");
  console.log("1. bun run db:push        # create data/node.db");
  console.log("2. bun run build && bun run start");
  console.log("3. point your shop at POST /api/v1/invoices with Bearer <LP_API_KEY>");
  console.log("4. register LP_WEBHOOK_URLS in your shop, verify with the secret");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
