/**
 * LibrePay Node — the single merchant IS the operator.
 *
 * A config-backed adapter that feeds the battle-tested invoice engine
 * (createInvoiceForMerchant & co.) without a merchants table, a dashboard,
 * or accounts. The node never holds spending keys:
 *   - payment code  → per-invoice stealth addresses (BIP47-style)
 *   - zpub / xpub   → deterministic watch-only addresses (m/0/{index})
 *   - phoenixd      → instant Lightning; the node only MINTS, never pays
 */

import { env, walletConfigured } from "@/lib/env";

/** Shape the engine expects (subset of the SaaS Merchant model). */
export interface MerchantConfig {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  logoUrl: string | null;
  walletMode: "selfcustody" | "watchonly" | "none";
  paymentCode: string | null;
  accountXpub: string | null;
  confirmationsRequired: number;
  invoiceExpiryMinutes: number;
  lightningUrl: string | null;
  lightningStatus: string; // "ok" when phoenixd is configured
  lightningPasswordEnc: null; // node keeps the phoenixd password in .env, never encrypted-at-rest
  refundsEnabled: boolean;
  refundWindowDays: number;
}

let cached: MerchantConfig | null = null;

export function getMerchant(): MerchantConfig {
  if (cached) return cached;
  cached = {
    id: "self",
    name: env.STORE_NAME,
    slug: "self",
    brandColor: env.BRAND_COLOR,
    logoUrl: null,
    walletMode: env.PAYMENT_CODE ? "selfcustody" : env.XPUB ? "watchonly" : "none",
    paymentCode: env.PAYMENT_CODE,
    accountXpub: env.XPUB,
    confirmationsRequired: env.CONFIRMATIONS_REQUIRED,
    invoiceExpiryMinutes: env.INVOICE_EXPIRY_MINUTES,
    lightningUrl: env.LIGHTNING_URL,
    lightningStatus: env.LIGHTNING_URL && env.LIGHTNING_PASSWORD ? "ok" : "none",
    lightningPasswordEnc: null,
    refundsEnabled: false, // manual refunds happen straight from the operator wallet
    refundWindowDays: 0,
  };
  return cached;
}

export { walletConfigured };

/** Pair webhook URLs with their signing secrets (1:1, or one secret for all). */
export function getWebhookEndpoints(): { url: string; secret: string }[] {
  const urls = env.WEBHOOK_URLS;
  const secrets = env.WEBHOOK_SECRETS;
  return urls.map((url, i) => ({ url, secret: secrets[i] ?? secrets[0] ?? "" })).filter((e) => e.secret);
}
