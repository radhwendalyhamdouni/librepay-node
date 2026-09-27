# Self-hosting LibrePay Node

## 0. Prerequisites

- A VPS: 1 vCPU / 2 GB RAM is plenty (BTCPay-class stacks want 4× that)
- Ubuntu 22.04+/Debian 12, a non-root user with sudo
- [Bun](https://bun.sh) ≥ 1.1 **or** Docker + Compose
- A wallet rail (choose one):
  - `LP_PAYMENT_CODE` — BIP47 payment code (stealth addresses, max privacy)
  - `LP_ZPUB` — BIP84 zpub from your wallet (watch-only)
  Both are *public* extended keys: the node can watch and derive, never spend.

## 1. Bare-metal install

```bash
git clone https://github.com/radhwendalyhamdouni/librepay-node
cd librepay-node
bun install

cp .env.example .env
bun run setup          # prints LP_API_KEY / LP_APP_SECRET / LP_WEBHOOK_SECRETS
# paste those into .env, add LP_STORE_NAME and your LP_ZPUB or LP_PAYMENT_CODE

bun run db:push
bun run build
sudo systemctl edit --force --full librepay-node   # unit below
sudo systemctl enable --now librepay-node
```

### systemd unit

```ini
[Unit]
Description=LibrePay Node
After=network-online.target

[Service]
User=youruser
WorkingDirectory=/opt/librepay-node
ExecStart=/usr/bin/env NODE_ENV=production PORT=3000 node .next/standalone/server.js
Restart=always
RestartSec=5
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/librepay-node/data
EnvironmentFile=/opt/librepay-node/.env

[Install]
WantedBy=multi-user.target
```

## 2. Docker install

```bash
cd docker
cp ../.env.example .env   # fill it; set LP_LIGHTNING_URL=http://phoenixd:9740
docker compose up -d
# Tor-only (get your .onion hostname):
docker compose --profile onion up -d
docker compose logs tor | grep -i onion
```

## 3. phoenixd (Lightning rail)

Set in `.env`:

```
LP_LIGHTNING_URL=http://127.0.0.1:9740   # or http://phoenixd:9740 in compose
LP_LIGHTNING_PASSWORD=<http-password from phoenixd output>
```

On first run phoenixd prints a **24-word seed and an http-password**. Back the
seed up offline — it IS your Lightning balance. The node only mints invoices;
it never calls `/payinvoice`.

## 4. TLS

### Clearnet (Caddy — automatic Let's Encrypt)

```
pay.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Set `LP_BASE_URL=https://pay.example.com` so checkout URLs are deterministic
behind the proxy.

### Tor-only

Run the compose tor profile (above). No domain, no TLS cert, no hoster KYC —
the onion address IS the endpoint. Webhooks are HMAC-signed, so receivers
verify authenticity without needing TLS trust.

## 5. Connect your shop

**WooCommerce** — copy `integrations/woocommerce/` to `wp-content/plugins/`,
enable, then set the node URL and `LP_API_KEY` in the plugin settings.

**Any platform** — implement two calls:

```http
POST /api/v1/invoices        Authorization: Bearer lp_live_…
GET  /api/v1/invoices/:id    Authorization: Bearer lp_live_…
```

and one webhook receiver (verify `X-LibrePay-Signature` over the raw body).
Full reference: [API.md](API.md).

## 6. Operations

- **Backups**: everything is `data/node.db` + `.env` + the phoenixd seed.
  `sqlite3 data/node.db ".backup '/backups/node-$(date +%F).db'"`
- **Updates**: `git pull && bun install && bun run build && sudo systemctl restart librepay-node`
- **Monitoring**: `GET /api/health` → 200 `{ok:true,db:true}`
- **Manual chain-watching** (if you disabled the embedded scheduler):
  `curl -X POST -H "Authorization: Bearer $LP_CRON_SECRET" https://…/api/cron/tick`
