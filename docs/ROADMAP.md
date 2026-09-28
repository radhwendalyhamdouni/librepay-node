# Roadmap — how the node becomes the best in class

Position: **self-hosted, zero-account, single-merchant gateway with a
BTCPay-grade console and a SaaS-grade API** — installable in minutes on any
VPS with SQLite, no Docker, no full node, no third party. The plan below is
ordered by what makes it *أكفأ، أضمن، أنجع* (most capable, most reliable,
most effective) against BTCPay Server and custodial SaaS gateways.

## P0 — guarantees (reliability hardening)

- [x] DB-queued webhooks, exponential backoff (1m→24h), dead-letter marking, signed HMAC, SSRF-guarded at delivery time
- [x] Tor v3 deployment kit + `.onion` webhook destinations (`docs/DEPLOY_TOR.md`)
- [x] **Idempotency-Key** on `POST /api/v1/invoices` (unique-index backed; replay header `Idempotency-Replayed: true`)
- [x] **Transactional outbox**: webhook rows written in the same SQLite transaction as the status change (zero-miss guarantee)
- [x] **Reorg-safe confirmations**: the ≥N-conf sighting must repeat on the next tick before `confirmed` fires; streak resets if confirmations drop
- [x] **Manual redrive**: console button (or `POST /api/system/webhooks {"action":"redrive"}`) requeues dead webhook deliveries
- [x] Settled-jump contract fix: confirmations that skip past the threshold emit `invoice.confirmed` AND `invoice.settled`, in order
- [x] **Health self-probe (v0.8.0)**: Esplora outage ALARM — 3 consecutive failures fire a signed `system.esplora_down` webhook (+ audit log), `system.esplora_up` on recovery with measured downtime, `system.esplora_stalled` for a frozen tip; while DOWN the cron probes once per tick instead of hammering the provider
- [x] Outage-safe cron: a missing chain tip can no longer zero confirmation counters (payment metadata is never written without chain data; time-based expiry keeps running)

## P1 — reach (integration surface)

- [x] WooCommerce plugin v2 (idempotency, invoice reuse, late-payment revival, connection test, orders column, HPOS)
- [x] Shopify bridge (`integrations/shopify/`): manual-payment pattern fully automated — idempotent invoices, signed webhooks, orderMarkAsPaid, resume links
- [x] `librepay.js` embed widget, copy-paste PHP/Node/Python examples
- [ ] Shopify Plus checkout extension (uses the same node API)
- [ ] PrestaShop / Drupal Commerce modules (community)
- [ ] `@librepay/client` npm package (thin typed wrapper around API v1)
- [ ] Self-hosted payment links (static invoice URLs generated from the console)

## P2 — power (operator experience)

- [x] BTCPay-style console: password+TOTP, managed sessions, step-up, recovery links, live security monitor, privacy modes, encrypted at rest, encrypted backups (local + remote)
- [x] Prometheus `/metrics` (v0.8.0): restart-safe gauges re-derived from SQLite — invoice lifecycle, outbox depth/dead-letters, chain provider health, db/process; scrape config + alert rules in docs/API.md
- [ ] `bun run update` — one-command upgrade: backup → pull → migrate → restart
- [ ] Official Docker image + compose hardening guide
- [ ] Lightning: LNURL-pay descriptors, multi-LSP notes (phoenixd self-custody stays the default)

## What we will NOT do (on purpose)

- No multi-tenant accounts/KYC — the key is the identity, the operator owns the box.
- No hot wallet on the node — watch-only xpub/BIP47 only; funds land in *your* wallet.
- No third-party runtime dependency — only the Bitcoin chain you configure.
