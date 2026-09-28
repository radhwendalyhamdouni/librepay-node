=== LibrePay for WooCommerce ===
Contributors: librepay
Tags: bitcoin, lightning, cryptocurrency, payment gateway, self-hosted, non-custodial
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 2.0.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Accept Bitcoin (on-chain + instant Lightning) with YOUR self-hosted LibrePay node. Non-custodial, no KYC, 0% fees.

== Description ==

LibrePay for WooCommerce connects your store to **your own** LibrePay node — a self-hosted,
non-custodial Bitcoin payment gateway. Money flows from the buyer's wallet directly into
YOUR wallet; the plugin and the node never hold spending keys.

**Highlights**

* **Non-custodial & private** — one-time stealth/watch-only addresses per order; the node cannot spend.
* **On-chain + Lightning** — buyers pick the rail on the hosted checkout; Lightning settles instantly.
* **Idempotent invoices** — double-clicks and network retries never mint a second invoice.
* **Smart retries** — an unpaid invoice is reused; an expired one bumps to a fresh address + fresh price.
* **Signed webhooks** — HMAC-SHA256 verified timing-safe against the raw body + 10-minute replay guard + per-delivery dedupe.
* **Late-payment recovery** — a payment after expiry re-opens the order and marks it paid automatically.
* **Underpaid handling** — configurable on-hold or note-only (beyond the node's 1% tolerance).
* **One-click connection test** — verifies URL + API key + wallet configuration in a single call.
* **Admin visibility** — Bitcoin column in the orders list, open-payment links, order notes with TXIDs.
* **HPOS compatible** — works with WooCommerce Custom Order Tables.
* **Settlement policy** — mark orders paid on first confirmation (fast) or on settlement (safest).

== Installation ==

1. Upload the plugin: Plugins → Add New → Upload Plugin → activate.
2. WooCommerce → Settings → Payments → "Bitcoin (LibrePay)" → Enable.
3. Paste your node URL, API key (`lp_live_…`) and webhook secret from the node console → "Connect your store".
4. Press **Test connection** — it must report the store name and wallet status.
5. In the node console, add the webhook URL shown in the settings screen to **Webhook destinations**.
6. Place a test order.

== Frequently Asked Questions ==

= Who holds the money? =
You do — instantly. Payments land on addresses derived from YOUR payment code / xpub.
The node is watch-only and cannot spend.

= What happens if a buyer pays after the invoice expired? =
The `invoice.confirmed` webhook re-opens a failed/cancelled order and marks it paid. Nothing is lost.

= Can I refund? =
Refunds are manual and non-custodial by design: send from your own wallet (the node dashboard
shows the payer address), then refund in WooCommerce manually.

= Does it work with the block-based checkout? =
Classic gateway. For Bitcoin use the legacy shortcode checkout (`[woocommerce_checkout]`) or
a page template with the classic checkout; block-checkout support is on the roadmap.

= Where do logs go? =
Enable "Debug log" in the gateway settings, then WooCommerce → Status → Logs → source `librepay`.

== Changelog ==

= 2.0.0 =
* Idempotency-Key on invoice creation; open-invoice reuse per order; attempt counter after expiry.
* Webhook replay guard (timestamp) + per-delivery dedupe + raw-body timing-safe verification.
* Late-payment revival, configurable expiry/underpaid behaviors, settlement policy.
* One-click connection test (node URL + key + wallet in one call).
* Orders-list Bitcoin column, resume-payment button on thank-you & My Account pages.
* WC logger, HPOS declaration, uninstall cleanup, i18n.

= 1.0.0 =
* Initial release: invoice redirect + signed webhooks.
