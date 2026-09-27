import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API — LibrePay Node",
  description: "Merchant API v1 reference for this LibrePay Node instance.",
};

const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/v1/invoices",
    auth: "Bearer lp_live_…",
    desc: "Create an invoice. Body: amountSats (int) OR amountFiat+currency (USD…), orderId?, description? (≤140), expiresInMinutes? (5–120), metadata? ({string: string|number|bool|null}). Returns 201 { invoice: {…}, checkoutUrl }.",
  },
  {
    method: "GET",
    path: "/api/v1/invoices/:id",
    auth: "Bearer lp_live_…",
    desc: "Invoice status. Returns { invoice: { id, status, amountSats, txid, confirmations, … } }.",
  },
  {
    method: "GET",
    path: "/api/public/invoice/:id",
    auth: "public by link",
    desc: "Checkout payload used by the payment page (minimal exposure).",
  },
  {
    method: "POST",
    path: "/api/cron/tick",
    auth: "Bearer LP_CRON_SECRET",
    desc: "Manual chain-watch pass (only needed when LP_CRON_INTERVAL_MS=0).",
  },
  {
    method: "GET",
    path: "/api/health",
    auth: "public",
    desc: "Liveness + db check.",
  },
];

const EVENTS = [
  "invoice.detected", "invoice.confirmed", "invoice.settled",
  "invoice.expired", "invoice.underpaid",
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Merchant API v1</h1>
          <p className="text-muted-foreground">
            Two authenticated endpoints. Fully self-hosted — this node talks to
            the Bitcoin chain and nothing else. The contract is wire-compatible
            with the LibrePay platform: existing clients work by changing the
            base URL and key only, with zero dependence on any third-party
            service.
          </p>
        </header>

        <section className="space-y-4">
          {ENDPOINTS.map((e) => (
            <div key={e.method + e.path} className="rounded-lg border p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-bold">
                  {e.method}
                </span>
                <code className="text-sm font-semibold">{e.path}</code>
                <span className="text-xs text-muted-foreground">{e.auth}</span>
              </div>
              <p className="text-sm text-muted-foreground">{e.desc}</p>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            Every lifecycle transition is POSTed to every URL configured in
            <code className="mx-1">LP_WEBHOOK_URLS</code> with headers
            <code className="mx-1">X-LibrePay-Signature: sha256=&lt;hmac(secret, raw body)&gt;</code>,
            <code className="mx-1">X-LibrePay-Event</code>,
            <code className="mx-1">X-LibrePay-Delivery-Id</code>.
            Retries: 1m → 24h (~8 attempts). Verify with timing-safe comparison over the RAW body.
          </p>
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((ev) => (
              <code key={ev} className="rounded bg-muted px-2 py-1 text-xs">{ev}</code>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Body shape: <code>{`{ event, invoiceId, data: { invoice: {…} }, timestamp }`}</code>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Connect WooCommerce (WordPress)</h2>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
            <li>
              Download the plugin{" "}
              <a href="/downloads/librepay-woocommerce.zip" download className="font-medium text-primary underline underline-offset-2">
                librepay-woocommerce.zip
              </a>{" "}
              and in WordPress go to Plugins → Add New → Upload Plugin.
            </li>
            <li>WooCommerce → Settings → Payments → “Bitcoin via LibrePay” → Enable.</li>
            <li>
              Open the <a href="/setup" className="font-medium text-primary underline underline-offset-2">operator console</a> →
              “Connect your store” and paste the base URL, API key and webhook secret into the plugin settings.
            </li>
            <li>
              In the console → “Webhook destinations” add{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">https://YOUR-SITE.com/wc-api/librepay_webhook</code>{" "}
              so the node notifies WooCommerce on every payment event.
            </li>
            <li>Place a test order — the order marks itself paid at the first confirmed block.</li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Any other stack (custom cart, Laravel, Django…) follows the same shape: create the invoice
            server-side with the API, redirect the customer to <code className="rounded bg-muted px-1.5 py-0.5 text-xs">checkoutUrl</code>,
            and flip the order to paid when the signed webhook arrives.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Status lifecycle</h2>
          <pre className="rounded-lg bg-muted p-4 text-xs overflow-x-auto">{`waiting ──(tx seen)──▶ detected ──(≥ N conf)──▶ confirmed ──(≥ 6 conf)──▶ settled
   └──(expiry)──▶ expired        underpaid (beyond 1% tolerance)`}</pre>
        </section>
      </div>
    </main>
  );
}
