/**
 * LibrePay Node — the single merchant IS the operator.
 *
 * A config-backed adapter that feeds the battle-tested invoice engine
 * (createInvoiceForMerchant & co.) without a merchants table, a dashboard,
 * or accounts. The node never holds spending keys:
 *   - payment code  → per-invoice stealth addresses (BIP47-style)
 *   - zpub / xpub   → deterministic watch-only addresses (m/0/{index})
 *   - phoenixd      → instant Lightning; the node only MINTS, never pays
 *
 * Values are read DYNAMICALLY from the settings layer (config.json → env →
 * defaults), so the first-run Setup Wizard takes effect instantly, with no
 * restart and no cache staleness.
 */

import { env } from "@/lib/env";
import { getSettings, isConfigured, walletConfigured } from "@/lib/server/settings";

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
  lightningPasswordEnc: null; // node keeps the phoenixd password in config/.env, never encrypted-at-rest
  refundsEnabled: boolean;
  refundWindowDays: number;
}

export function getMerchant(): MerchantConfig {
  const s = getSettings();
  return {
    id: "self",
    name: s.storeName,
    slug: "self",
    brandColor: s.brandColor,
    logoUrl: s.logoUrl,
    walletMode: s.paymentCode ? "selfcustody" : s.xpub ? "watchonly" : "none",
    paymentCode: s.paymentCode,
    accountXpub: s.xpub,
    confirmationsRequired: s.confirmationsRequired,
    invoiceExpiryMinutes: s.invoiceExpiryMinutes,
    lightningUrl: s.lightning.url,
    lightningStatus: s.lightning.url && s.lightning.password ? "ok" : "none",
    lightningPasswordEnc: null,
    refundsEnabled: false, // manual refunds happen straight from the operator wallet
    refundWindowDays: 0,
  };
}

/** Public base URL for checkout links: settings override, env fallback. */
export function getBaseUrl(): string {
  return getSettings().baseUrl || env.BASE_URL;
}

export { walletConfigured, isConfigured };

/** Pair webhook URLs with their signing secrets (1:1, or one secret for all). */
export function getWebhookEndpoints(): { url: string; secret: string }[] {
  const s = getSettings();
  const urls = s.webhookUrls.length ? s.webhookUrls : env.WEBHOOK_URLS;
  const secrets = s.webhookSecrets.length ? s.webhookSecrets : env.WEBHOOK_SECRETS;
  return urls
    .map((url, i) => ({ url, secret: secrets[i] ?? secrets[0] ?? "" }))
    .filter((e) => e.secret);
}
