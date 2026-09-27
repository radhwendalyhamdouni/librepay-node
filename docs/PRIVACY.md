# Privacy

## What the node stores

- **Invoices**: amount, status, stealth address, derivation index, optional
  `orderId`/`description`/`metadata` that *you* chose to attach, and the txid
  once a payment is seen. That's the ledger.
- **Webhook deliveries**: the signed payload and delivery outcome, so retries
  are honest and inspectable.
- **Nothing else.** No users table. No sessions. No emails. No IPs at rest
  (IPs are used only for in-memory rate limiting and are never persisted).

## What the node refuses to know

- No KYC — there is nothing to comply *with*; the operator is the merchant.
- No cookies for tracking. The checkout stores the buyer's language choice in
  `localStorage` — on their device, not yours.
- No third-party analytics, fonts, or scripts. The checkout is self-contained.

## What leaves the machine

- Esplora queries (`mempool.space` by default) for chain data: address
  activity and fiat rates. **Privacy note**: an Esplora provider sees which
  addresses you query. Self-host Electrum/mempool and point `ESPLORA_API` at
  it for full-network privacy — one line in `.env`.
- Webhooks to the URLs **you** configured, signed, SSRF-guarded.
- phoenixd talks to the Lightning network (ACINQ LSP for liquidity).

## Buyer-facing data

The public checkout endpoint returns the minimum: status, amount, address,
description. No order metadata, no merchant internals, no accounting. The
buyer's browser only talks to your node.

## Deleting everything

Stop the service and delete `data/node.db`. There is nothing to "request
removal" of anywhere else — the data was never anywhere else.
