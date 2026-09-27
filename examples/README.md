# Integration examples

Wire any external website to a self-hosted LibrePay Node. The contract is
three steps: **create invoice → send buyer to `checkoutUrl` → verify signed
webhook**. Copy the file for your stack, fill in two values (node base URL +
API key) and you are live.

| file | what it shows |
|---|---|
| [`create-invoice.php`](create-invoice.php) | PHP/cURL — create invoice, redirect buyer |
| [`create-invoice-node.mjs`](create-invoice-node.mjs) | Node 18+ `fetch` — create invoice |
| [`create-invoice-python.py`](create-invoice-python.py) | Python/requests — create invoice |
| [`webhook-receiver-node.mjs`](webhook-receiver-node.mjs) | Node/Express — verify signature (timing-safe), react to `invoice.confirmed`, idempotency |
| [`webhook-receiver.php`](webhook-receiver.php) | PHP — same for a plain-PHP shop |
| [`widget-proxy-next.ts`](widget-proxy-next.ts) | backend route for the `librepay.js` embed button (keeps the API key off the browser) |
| [`../integrations/woocommerce`](../integrations/woocommerce) | full WordPress/WooCommerce gateway plugin |

Rules that keep you safe (all examples follow them):

1. The `lp_live_…` API key lives **only** on your server. Never in a browser,
   never in a mobile app.
2. Verify `X-LibrePay-Signature` against the **raw** body before parsing JSON,
   with a timing-safe compare.
3. Treat webhook deliveries as *at-least-once* — dedupe on
   `X-LibrePay-Delivery-Id` (or invoice id + event) before fulfilling orders.
4. Release goods on `invoice.confirmed` (default 2 confirmations, instant for
   Lightning). `invoice.settled` (6+) is the deep-finality signal.
