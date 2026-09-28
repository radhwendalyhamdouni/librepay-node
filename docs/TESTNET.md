# Running LibrePay Node on Bitcoin testnet4

Testnet4 is Bitcoin's public rehearsal chain: same protocol, coins are free
from a faucet and worth nothing. Running a node with `LP_NETWORK=testnet`
lets you exercise the FULL payment flow — setup → invoice → on-chain payment
→ confirmations → settled → webhook — without touching a single real satoshi.

This is the recommended path for the first-run demo, screenshots, the launch
video, and grant/integration reviewers.

## 1. Flip the network

```env
LP_NETWORK=testnet
```

That single setting moves everything together (no other edits required):

| What                       | mainnet                    | testnet (testnet4)                     |
| -------------------------- | -------------------------- | -------------------------------------- |
| Invoice addresses          | `bc1q…`                    | `tb1q…`                                |
| Watch-only key flavor      | `zpub` (or `xpub`)         | `vpub` (or `tpub`)                     |
| BIP84 account path         | `m/84'/0'/0'`              | `m/84'/1'/0'`                          |
| Default Esplora API        | `mempool.space/api`        | `mempool.space/testnet4/api`           |
| Explorer links on checkout | `mempool.space/tx/…`       | `mempool.space/testnet4/tx/…`          |
| BTC price feed             | Esplora `/v1/prices`       | mainnet `/v1/prices` (price is chain-independent) |

The Cold Wallet generator (`/cold`) reads the node's network and derives
testnet keys automatically (badge confirms it). Mixed keys are rejected
loudly: pasting a mainnet `zpub` into a testnet node — or a `vpub` into a
mainnet node — fails at setup instead of silently producing addresses that
can never be paid.

## 2. Get a testnet wallet + free coins

Any BIP84 testnet wallet works — Sparrow (testnet mode), Electrum (testnet),
or the node's own `/cold` generator while `LP_NETWORK=testnet`:

- Sparrow: File → New wallet → in the network dropdown pick **Testnet4**,
  import the `vpub` as watch-only, or the seed words if it is your own wallet.
- Faucet: <https://mempool.space/testnet4/faucet> sends free tBTC to any
  `tb1…` address (it also doubles as the block explorer).
- Paste the **vpub** (not zpub) into Setup → Wallet. The proof address shown
  by the wizard must start with `tb1q` — that is your cross-check.

## 3. Run the demo flow

1. `bun run setup` (or the Setup Wizard) with `LP_NETWORK=testnet` in `.env`.
2. Create an invoice from the dashboard or
   `POST /api/v1/invoices` (`examples/` has ready-made snippets).
3. Pay the `tb1…` address from the faucet or your testnet wallet.
4. Watch 0-conf → N confirmations → `settled` on the invoice page, and the
   HMAC-signed webhook arriving at your receiver (`examples/webhook-receiver-node.mjs`).

## 4. What does NOT work on testnet

- **Lightning (phoenixd)**: phoenixd is mainnet-only. Leave `LP_LIGHTNING_URL`
  unset on a testnet node — invoices fall back to the on-chain rail, which is
  exactly what the demo needs.
- **Real economics**: testnet4 has no fees pressure and cheap blocks. It
  proves *correctness* (keys, addresses, watch logic, webhooks), not
  production load. Mainnet deployment checklist stays in docs/SELF-HOSTING.md.

## 5. Legal & ops note

Testnet coins have no market value and no transfer of value takes place —
that makes a testnet demo the safest artifact to publish from jurisdictions
with unclear crypto regulation. Keep the production node mainnet-only and
never share a mainnet `.env`.
