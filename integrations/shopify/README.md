# LibrePay ⇄ Shopify

Bitcoin on Shopify **without Shopify Plus** — the honest, working pattern,
end-to-end automated by a tiny self-hosted bridge.

## How it works (and why)

Shopify only lets Plus plans replace the checkout payment step. For every
other plan the proven path is a **manual payment method** + automation —
exactly how legacy crypto gateways do it:

```
buyer checks out ("Bitcoin (LibrePay)" manual method)
        │  Shopify webhook: orders/create
        ▼
bridge.mjs  ──►  LibrePay node: POST /api/v1/invoices  (Idempotency-Key!)
        │            invoice locked at the live BTC rate
        ▼
payment link appended to the Shopify order note
        │  buyer pays (QR — on-chain stealth address or instant Lightning)
        ▼
node webhook: invoice.confirmed  ──►  bridge marks the order PAID
        (Shopify Admin GraphQL orderMarkAsPaid — fulfills like any paid order)
```

Everything the WooCommerce plugin guarantees holds here too: idempotent
invoice creation, replay-guarded signed webhooks, per-delivery dedupe,
late-payment revival (an expired invoice bumps to a fresh attempt), and
cancelled orders never get auto-marked paid.

## Requirements

- Node 18+ (no npm install — zero dependencies)
- A public **https** URL for the bridge (Caddy/nginx or a tunnel); Shopify
  webhooks refuse plain http
- LibrePay node URL + API key (`lp_live_…`) + webhook secret (`whsec_…`)
- Shopify custom app token with `write_orders` scope

## Setup (15 minutes)

**1 — Shopify custom app** (gives the bridge its token + webhook secret):
1. Shopify admin → **Settings → Apps and sales channels → Develop apps → Create an app**.
2. *Configure Admin API scopes*: enable `write_orders`, `read_orders`. Save + install.
3. Copy **Admin API access token** (`shpat_…`) and the **API secret key**
   (shown under API credentials — the latter signs webhooks).

**2 — Manual payment method** (the checkout button buyers see):
1. Settings → Payments → Manual payment methods → **Create**.
2. Name: `Bitcoin (LibrePay)` · select "Mark payment as pending" · extra
   details: *"You will receive the Bitcoin payment link in your order
   confirmation — click it to pay with the on-chain QR or instant Lightning."*

**3 — Configure the bridge** (`.env` next to bridge.mjs or systemd env):

```
PORT=8787
BASE_URL=https://bridge.example.com
SHOPIFY_STORE_DOMAIN=myshop.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxx
SHOPIFY_WEBHOOK_SECRET=shpss_xxxxxxxxxxxxxxxx
LIBREPAY_NODE_URL=https://pay.example.com
LIBREPAY_API_KEY=lp_live_xxxx…
LIBREPAY_WEBHOOK_SECRET=whsec_xxxx…
# optional — exact-match overrides (substring, lowercase):
# SHOPIFY_GATEWAY_MATCH=bitcoin,librepay,btc
# STATE_FILE=/var/lib/librepay-shopify/state.json
```

**4 — Register webhooks + run:**

```bash
SHOPIFY_STORE_DOMAIN=myshop.myshopify.com \
SHOPIFY_ADMIN_TOKEN=shpat_… \
BASE_URL=https://bridge.example.com \
node register-webhooks.mjs        # registers orders/create|updated|cancelled

node bridge.mjs                   # or the systemd unit in this folder
curl https://bridge.example.com/healthz
```

**5 — Also tell the node about the bridge:** in the node console →
Webhook destinations → add `https://bridge.example.com/webhooks/librepay`.

**6 — Test order:** place an order with the Bitcoin method → within seconds
the order gets a note with the payment link → pay (or use the node's test
tooling) → the order flips to **Paid** automatically.

## Buyer experience

- Order confirmation email contains Shopify's manual-payment instructions;
  the exact payment link is on the order status page (via the order note
  shown there) and stays valid until the invoice expires.
- A stable resume link exists forever: `https://bridge.example.com/pay/{orderId}`
  (it lazily mints the invoice if needed, then 302s to the checkout).
- Expired invoice? The buyer re-clicking the link gets a **fresh** invoice at
  the **fresh** BTC rate — no support ticket needed.

## Security notes

- Both inbound webhooks are HMAC-verified (Shopify base64 HMAC, LibrePay
  `sha256=…` hex HMAC) against the raw body, timing-safe, plus a 10-minute
  freshness check on LibrePay deliveries.
- State is a local JSON file with atomic writes; secrets live only in env.
- The bridge never holds money and never talks to wallets — it only mints
  invoices and flips order statuses.
- Run it with the provided hardened systemd unit (no capabilities, strict fs).

## Shopify Plus note

On Plus, the gold path is a **Checkout UI extension** using the same node
API — the bridge's invoice flow stays identical. The manual-method pattern
above remains useful for B2B/draft orders even there.
