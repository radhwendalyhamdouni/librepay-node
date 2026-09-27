# Roadmap — how the node becomes the best in class

Position: **self-hosted, zero-account, single-merchant gateway with a
BTCPay-grade console and a SaaS-grade API** — installable in minutes on any
VPS with SQLite, no Docker, no full node, no third party. The plan below is
ordered by what makes it *أكفأ، أضمن، أنجع* (most capable, most reliable,
most effective) against BTCPay Server and custodial SaaS gateways.

## P0 — guarantees (reliability hardening)

- [x] DB-queued webhooks, exponential backoff (1m→24h), dead-letter marking, signed HMAC, SSRF-guarded at delivery time
- [x] Tor v3 deployment kit + `.onion` webhook destinations (`docs/DEPLOY_TOR.md`)
- [ ] **Idempotency-Key** on `POST /api/v1/invoices` (client-safe retries for flaky networks)
- [ ] **Transactional outbox**: enqueue webhook rows in the same SQLite transaction as the status change (zero-miss guarantee)
- [ ] **Reorg-safe confirmations**: verify tx block-depth twice before `confirmed` (already requires N confs; add a re-check tick) + explicit `invoice.reorged` event
- [ ] **Manual redrive**: console button to requeue dead webhook deliveries
- [ ] Health self-probe: cron alerts (security log) if Esplora/phoenixd unreachable for N ticks

## P1 — reach (integration surface)

- [x] WooCommerce plugin, `librepay.js` embed widget, copy-paste PHP/Node/Python examples
- [ ] Shopify recipe (custom payment method + payment-link flow)
- [ ] PrestaShop / Drupal Commerce modules (community)
- [ ] `@librepay/client` npm package (thin typed wrapper around API v1)
- [ ] Self-hosted payment links (static invoice URLs generated from the console)

## P2 — power (operator experience)

- [x] BTCPay-style console: password+TOTP, managed sessions, step-up, recovery links, live security monitor, privacy modes, encrypted at rest, encrypted backups (local + remote)
- [ ] Prometheus `/metrics` (invoice counters, webhook latency, cron tick age)
- [ ] `bun run update` — one-command upgrade: backup → pull → migrate → restart
- [ ] Official Docker image + compose hardening guide
- [ ] Lightning: LNURL-pay descriptors, multi-LSP notes (phoenixd self-custody stays the default)

## What we will NOT do (on purpose)

- No multi-tenant accounts/KYC — the key is the identity, the operator owns the box.
- No hot wallet on the node — watch-only xpub/BIP47 only; funds land in *your* wallet.
- No third-party runtime dependency — only the Bitcoin chain you configure.
