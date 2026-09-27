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
| 🔐 **Strict API** | Zod-validated, rate-limited, `lp_live_` keys, SSRF-guarded outbound calls. |

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
  into your plugins folder, set the node URL + API key. Done.
- **Any other platform**: the full API is two authenticated endpoints —
  [docs/API.md](docs/API.md) has every field and every webhook event.

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
