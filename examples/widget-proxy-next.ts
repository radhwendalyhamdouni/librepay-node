/**
 * LibrePay Node — backend proxy for the `librepay.js` embed button.
 *
 * The widget (public/librepay.js) POSTs to a route on YOUR site; that route
 * forwards to the node with the API key, which never touches the browser.
 *
 * Next.js App Router: save as app/api/librepay/create-invoice/route.ts
 * The button then needs zero config:
 *   <script src="https://your-node.example.com/librepay.js"></script>
 *   <button class="librepay-button" data-amount-fiat="27.5" data-currency="USD"
 *           data-order-id="1042" data-description="Two coffees">Pay</button>
 */

export async function POST(req: Request): Promise<Response> {
  const NODE_URL = process.env.LIBREPAY_NODE_URL ?? "";   // your node base URL
  const API_KEY = process.env.LIBREPAY_API_KEY ?? "";     // lp_live_… server-side only

  if (!NODE_URL || !API_KEY) {
    return Response.json({ error: "gateway not configured" }, { status: 500 });
  }

  // Only forward whitelisted fields — never trust the client with extra params.
  const body = await req.json().catch(() => null);
  const amountFiat = Number(body?.amountFiat);
  const amountSats = Number(body?.amountSats);
  const payload: Record<string, unknown> = {
    orderId: String(body?.orderId ?? "").slice(0, 64) || `w-${Date.now()}`,
    description: String(body?.description ?? "").slice(0, 140),
    buyerLang: String(body?.buyerLang ?? "").slice(0, 8) || undefined,
  };
  if (amountSats > 0) payload.amountSats = Math.floor(amountSats);
  else if (amountFiat > 0) {
    payload.amountFiat = amountFiat;
    payload.currency = String(body?.currency ?? "USD").slice(0, 8);
  } else {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const res = await fetch(`${NODE_URL}/api/v1/invoices`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    return Response.json({ error: "INVOICE_FAILED" }, { status: 502 });
  }

  const data = (await res.json()) as { invoice: { id: string }; checkoutUrl: string };
  // The widget opens data.checkoutUrl automatically when present.
  return Response.json({ invoice: { id: data.invoice.id }, checkoutUrl: data.checkoutUrl });
}
