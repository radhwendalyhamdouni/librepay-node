/**
 * LibrePay Node — create invoice (Node 18+, no dependencies).
 * Drop this into any route handler / server action / cron job.
 */

const NODE_URL = process.env.LIBREPAY_NODE_URL ?? "https://pay.example.com";
// lp_live_… — server-side env secret ONLY, never exposed to the browser
const API_KEY = process.env.LIBREPAY_API_KEY ?? "";

export async function createInvoice(order: {
  total: number;
  currency: string;
  id: string;
  description?: string;
}) {
  const res = await fetch(`${NODE_URL}/api/v1/invoices`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      amountFiat: order.total,
      currency: order.currency,
      orderId: order.id,
      description: order.description?.slice(0, 140),
      // metadata rides along on every webhook event — put your refs here
      metadata: { source: "my-shop" },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`librepay invoice failed (HTTP ${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    invoice: { id: string; status: string; amountSats: string; stealthAddress: string };
    checkoutUrl: string;
  };

  // Persist data.invoice.id on the order row — the webhook references it.
  // Redirect the buyer:  res.redirect(data.checkoutUrl)
  // Or render your own QR from invoice.stealthAddress + invoice.amountSats.
  return data;
}

// quick self-test:  node --experimental-strip-types examples/create-invoice-node.mjs
if (process.argv[1]?.endsWith("create-invoice-node.mjs")) {
  createInvoice({ total: 27.5, currency: "USD", id: "demo-1042", description: "Order #1042" })
    .then((d) => console.log(JSON.stringify(d, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
