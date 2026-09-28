# ₿ LibrePay Node

<div align="center">
  <img src="public/brand/logo-lockup-dark.png" alt="LibrePay — Your payments. Your server. Your keys." width="420" />
</div>

**Your payments. Your server. Your keys.**

Self-hosted, non-custodial Bitcoin payment gateway. One process, one database,
one command. On-chain **stealth addresses** for privacy, **instant Lightning**
via a bundled [phoenixd](https://github.com/ACINQ/phoenixd), signed webhooks
for your shop — and **zero accounts, zero KYC, zero custodial risk**.

> بوابة دفع بيتكوين ذاتية الاستضافة وغير الحاجزة — عناوين ستيلث على السلسلة
> ولايتنين فوري عبر phoenixd. لا حسابات، لا KYC، والمفاتيح لا تلمس الخادم أبداً.

[English](#-one-command-install) · [العربية](#-التثبيت-بأمر-واحد)

---

## ⚡ One-command install

The installer detects your server type (Debian/Ubuntu, Fedora/RHEL, Arch,
openSUSE, Alpine — or Docker) and does everything:

```bash
curl -fsSL https://raw.githubusercontent.com/radhwendalyhamdouni/librepay-node/main/install.sh | bash
# or with automatic HTTPS:
bash install.sh --domain pay.example.com
# or Docker:
bash install.sh --docker
```

It prints your **node URL** and a **one-time setup code**, then:

## 🧙 First-run wizard — 5 questions and you're live

Open `https://your-node/setup` — the node walks you through:

1. **Setup code** (proof of server access: `cat data/SETUP_TOKEN`)
2. **Store identity** — name + brand color
3. **Receiving wallet** — watch-only `zpub` or BIP47 **payment code**;
   the node derives a real address as *proof* it sees your wallet before accepting it
4. **Payment policy** — confirmations + invoice expiry
5. **Backups** — periodic schedule, retention, optional SSH off-server copy
   and an AES-256-GCM passphrase

Press **🚀 LAUNCH NODE** — your API key is issued (shown exactly once),
the setup code self-destructs, and the node starts receiving Bitcoin.

## 💾 Backups & restore

- **Automatic**: the embedded scheduler takes an encrypted archive
  (consistent `VACUUM INTO` snapshot + config) every N hours, keeps the last N.
- **Off-server**: set `user@host:/path` in the operator console — archives are
  pushed with `scp` (SSH transport) and, with a passphrase, are
  **AES-256-GCM encrypted at rest**.
- **Restore**: download or upload an archive at `/setup`, or use the API —
  files are staged safely, applied by `npm run restore` (with a pre-restore
  snapshot), then one restart.

## Features

| | |
|---|---|
| 🔒 **Non-custodial by architecture** | Watch-only zpub or BIP47 payment code — the node *sees* payments but mathematically *cannot spend*. Funds land directly in your wallet. |
| 🕶 **Stealth addresses (on-chain privacy)** | Every invoice derives a one-time address from your payment code. Payers never learn your wallet's history. |
| ⚡ **Instant Lightning, zero ops** | phoenixd sidecar: automatic channels & liquidity via ACINQ LSP. Mint bolt11, never touch channel management. |
| 🧠 **One merchant = config** | No users, no plans, no billing. A single `.env` IS the merchant. |
| 📡 **Signed webhooks** | HMAC-SHA256 over the raw body, timing-safe verification, 8 retries over ~24h. |
| 🌍 **6-language checkout** | en · ar (RTL) · fr · es · pt · fil — detected from the buyer's browser. |
| 🕐 **Self-watching** | Embedded chain watcher (Esplora) — no external cron needed. |
| 🚨 **Self-monitoring (v0.8.0)** | Esplora outage ALARM: signed `system.esplora_down/_up/_stalled` webhook + Prometheus `/metrics` — a fallen chain provider can never fail silently. |
| 🔐 **Strict API** | Zod-validated, rate-limited, `lp_live_` keys, SSRF-guarded outbound calls. |
| 🏝 **Fully independent** | No platform behind it. No SaaS, no accounts, no phone-home. Every external touchpoint (chain data, explorer links, Lightning, webhooks) is configured by YOU and stays under YOUR control. |

## 🏝 Independence — no platform, no third party

LibrePay Node is not a client of any payment service. It is the whole payment
service, on your box:

- **Zero runtime calls to any platform.** Nothing in the codebase talks to
  librepay.tech or any vendor API. The node speaks directly to the Bitcoin
  chain and (optionally) your own phoenixd.
- **Chain data you choose.** `ESPLORA_API` defaults to mempool.space for
  convenience, but point it at your own Esplora/mempool instance (or even a
  local Electrum-backed one) and the node never touches a public service.
- **Explorer links follow your setup.** "View transaction" links on the
  checkout page are derived from `ESPLORA_API` — self-host your mempool UI
  and buyers stay on your infrastructure too.
- **Pricing without oracles you don't trust.** USD-anchored quotes try public
  price feeds (Esplora → CoinGecko → blockchain.info) and fall back to static
  rates offline; the primary source is your configured Esplora. A fully
  offline node still issues invoices at the last-known rate — checkout never
  breaks.
- **Cold wallet generator built in.** `https://your-node/cold` is a static,
  100% client-side page: load it, disconnect from the internet, generate a
  BIP39 mnemonic + BIP47 payment code or BIP84 zpub. Nothing is sent,
  stored, or logged — the browser tab is the tool. No external wallet
  generator website involved, ever.
- **Webhooks go only where YOU say.** Signed HMAC deliveries to endpoints you
  own; SSRF guards block everything else.

Wire-compatibility with the LibrePay SaaS contract is a convenience for
migration (same API shape for WooCommerce / existing clients), not a
dependency — the node runs forever with no other machine on the internet
except Bitcoin itself.

## The honest risk model

- **phoenixd is a hot wallet** for Lightning amounts. Keep channel balance small;
  large invoices ride the on-chain stealth rail anyway.
- **ACINQ LSP** provides Lightning liquidity — a deliberate trade of
  decentralization for zero-ops. Disclosed, not hidden.
- The node **never** calls phoenixd's `/payinvoice` — it cannot move your
  Lightning balance.

## Quick start (Docker)

```bash
git clone https://github.com/radhwendalyhamdouni/librepay-node
cd librepay-node/docker
cp ../.env.example .env      # edit: store name, wallet, keys
docker compose up -d
```

## Quick start (bare VPS)

```bash
git clone https://github.com/radhwendalyhamdouni/librepay-node
cd librepay-node
bun install
bun run setup          # generates LP_API_KEY / LP_APP_SECRET / webhook secret
bun run db:push        # creates data/node.db
bun run build && bun run start   # :3000
```

Systemd units, Caddy TLS, and Tor-only operation are documented in
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

## Receive money in 3 lines

```bash
curl -X POST https://your-node.example.com/api/v1/invoices \
  -H "Authorization: Bearer lp_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amountFiat": 25.00, "currency": "USD", "orderId": "order-42"}'
# → 201 { "invoice": { "id": "…", "status": "waiting", … }, "checkoutUrl": "https://…/pay/…" }
```

Send the buyer to `checkoutUrl` (or render your own page from the response).
Payment appears in your wallet; your webhook receives `invoice.confirmed`.

## Connect an e-commerce store

- **WooCommerce**: drop [`integrations/woocommerce/`](integrations/woocommerce/)
  (v2.0 — idempotent invoices, invoice reuse, late-payment revival, one-click
  connection test, orders-list column, HPOS) into your plugins folder, paste
  the node URL + API key, press **Test connection**. Done.
- **Shopify**: [`integrations/shopify/`](integrations/shopify/) — a
  dependency-free self-hosted bridge that automates the manual-payment
  pattern end-to-end (invoice on checkout, order marked paid on confirm).
- **Any platform, copy-paste**: ready-made integration snippets in
  [`examples/`](examples/) — PHP, Node, Python, a hardened webhook receiver
  (timing-safe signature check + idempotency), and a backend proxy for the
  [`librepay.js`](public/librepay.js) embed button.
- **The full contract**: two authenticated endpoints —
  [docs/API.md](docs/API.md) has every field, the Idempotency-Key semantics,
  and every webhook event.

## Deploy on Tor

Yes, it runs as a Tor v3 hidden service — clearnet + onion mirror (recommended)
or onion-only. One drop-in torrc, hardened systemd unit, cookie/webhook/explorer
details: [docs/DEPLOY_TOR.md](docs/DEPLOY_TOR.md). Set `LP_ONION_URL` to
auto-offer the mirror via `Onion-Location`.

## Know when the chain falls (v0.8.0)

The one dependency the node doesn't fully control is the chain-data provider.
librepay-node watches the watcher:

- **Alarm webhook** — `LP_ALARM_WEBHOOK_URL` gets one signed JSON POST on
  `system.esplora_down` (after 3 consecutive failures), `system.esplora_up`
  (with measured downtime) and `system.esplora_stalled` (frozen tip). Same
  HMAC contract as payment webhooks — your existing receiver verifies it as-is.
- **Prometheus** — `GET /api/metrics` (Bearer key or console cookie) exposes
  `librepay_chain_provider_up`, outbox depth, dead letters, invoice lifecycle
  and process health. Scrape config + ready-made alert rules:
  [docs/API.md](docs/API.md) § Metrics.
- **Outage-safe by construction** — while the provider is down the cron makes
  one cheap probe per tick instead of hammering it, never writes payment
  metadata without a tip, and keeps expiring invoices on schedule. Late
  payments still revive expired invoices when the chain comes back.

## Where this is going

Prioritized plan (Shopify Plus checkout, PrestaShop, npm client, one-command
update, Docker): [docs/ROADMAP.md](docs/ROADMAP.md).

## Status lifecycle

```
waiting ──(tx seen)──▶ detected ──(≥ N conf)──▶ confirmed ──(≥ 6 conf)──▶ settled
   └──(expiry)──▶ expired        underpaid (beyond 1% tolerance)
```

Delivery/goods release belongs to **you**, triggered by the
`invoice.confirmed` webhook — the node only reports chain truth.

## Security

- Threat model, key custody boundaries, and hardening checklist:
  [docs/SECURITY.md](docs/SECURITY.md)
- What the node stores (and refuses to store): [docs/PRIVACY.md](docs/PRIVACY.md)
- Found something? Read SECURITY.md for responsible disclosure.

## License

[AGPL-3.0-only](LICENSE) — free software, copyleft. If you offer this as a
service, the source of your modified version must be available to your users.

---

## المزايا

| | |
|---|---|
| 🔒 **غير حاجزة بالبنية** | zpub مراقِب أو كود دفع BIP47 — العقدة *ترى* الدفعات ولا تستطيع الصرف رياضياً. الأموال تهبط بمحفظتك مباشرة. |
| 🕶 **عناوين ستيلث** | كل فاتورة تُشتق عنواناً لمرة واحدة من كود الدفع — الدافع لا يعرف شيئاً عن تاريخ محفظتك. |
| ⚡ **لايتنين فوري بلا عمليات** | phoenixd مدمج: قنوات وسيولة تلقائية. توليد bolt11 بلا إدارة قنوات. |
| 🧠 **تاجر واحد = ملف إعدادات** | لا مستخدمون ولا خطط ولا فوترة. `.env` واحد هو التاجر كله. |
| 📡 **ويب‌هوك موقّعة** | HMAC-SHA256 على الجسم الخام، تحقق timing-safe، ‏8 إعادات خلال ~24 ساعة. |
| 🌍 **دفع بست لغات** | عربية (RTL) · إنجليزية · فرنسية · إسبانية · برتغالية · فلبينية. |
| 🕐 **تراقب السلسلة بنفسها** | مراقب Esplora مدمج — لا cron خارجي. |

**التشغيل السريع**: `git clone` ثم `bun install` ثم `bun run setup` ثم `bun run db:push` ثم `bun run build && bun run start` — والتفاصيل في [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

**الربط بمتجرك**: إضافة WooCommerce جاهزة في `integrations/woocommerce/`، وأي منصة أخرى تحتاج نقطتين API فقط.

**نموذج المخاطر بصدق**: phoenixd محفظة ساخنة للكميات الصغيرة الفورية؛ الكبيرة تسير على سكة الستيلث الباردة. سيولة ACINQ مركزية — مقايضة معلنة. العقدة لا تستطيع تحريك رصيدك إطلاقاً.

**الترخيص**: AGPL-3.0.
