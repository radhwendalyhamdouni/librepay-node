#!/usr/bin/env node
/**
 * LibrePay ⇄ Shopify bridge — self-hosted, dependency-free (Node 18+).
 *
 * Shopify (non-Plus) cannot host a custom payment page inside checkout, so
 * this bridge runs the proven manual-payment pattern end-to-end:
 *
 *   1. buyer checks out with the manual payment method "Bitcoin (LibrePay)"
 *      → Shopify fires orders/create →
 *   2. bridge mints an idempotent LibrePay invoice and appends the payment
 *      link as an order note (buyer-facing resume link always works too) →
 *   3. buyer pays on the hosted checkout (QR, on-chain or Lightning) →
 *   4. the node fires invoice.confirmed → bridge marks the Shopify order
 *      PAID via the Admin GraphQL API (orderMarkAsPaid), idempotently.
 *
 * Configure: see integrations/shopify/README.md
 * Run:       node bridge.mjs
 * Endpoints:
 *   POST /webhooks/shopify    ← Shopify (orders/create, orders/cancelled)
 *   POST /webhooks/librepay   ← LibrePay node (signed events)
 *   GET  /pay/:orderRef       ← manual fallback link for the buyer
 *   GET  /healthz
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "node:http";

// ── config ───────────────────────────────────────────────────────────────────
const cfg = {
  port: Number(process.env.PORT ?? 8787),
  baseUrl: (process.env.BASE_URL ?? "").replace(/\/$/, ""),            // public https URL of THIS bridge
  shopDomain: (process.env.SHOPIFY_STORE_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""), // myshop.myshopify.com
  shopToken: process.env.SHOPIFY_ADMIN_TOKEN ?? "",                    // shpat_… (write_orders)
  shopApiVersion: process.env.SHOPIFY_API_VERSION ?? "2024-10",
  shopWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET ?? "",         // custom-app "API secret key"
  gatewayMatch: (process.env.SHOPIFY_GATEWAY_MATCH ?? "bitcoin,librepay,crypto,btc")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  nodeUrl: (process.env.LIBREPAY_NODE_URL ?? "").replace(/\/$/, ""),
  nodeKey: process.env.LIBREPAY_API_KEY ?? "",                         // lp_live_…
  nodeSecret: process.env.LIBREPAY_WEBHOOK_SECRET ?? "",               // whsec_…
  stateFile: resolve(process.env.STATE_FILE ?? "./librepay-shopify-state.json"),
};

function fail(msg) {
  console.error("[bridge] CONFIG ERROR:", msg);
  process.exit(1);
}
if (!cfg.nodeUrl || !cfg.nodeKey) fail("LIBREPAY_NODE_URL and LIBREPAY_API_KEY are required");
if (!cfg.shopDomain || !cfg.shopToken) fail("SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN are required");

// ── tiny JSON state (atomic writes) ──────────────────────────────────────────
const state = existsSync(cfg.stateFile) ? JSON.parse(readFileSync(cfg.stateFile, "utf8")) : {};
function persist() {
  const tmp = cfg.stateFile + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, cfg.stateFile);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function hmacHex(secret, body) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}
function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
async function fetchJson(url, opts = {}, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    return { status: res.status, ok: res.ok, json, text };
  } finally {
    clearTimeout(t);
  }
}

/** Admin REST helper. */
async function shopifyRest(method, path, body) {
  return fetchJson(`https://${cfg.shopDomain}/admin/api/${cfg.shopApiVersion}/${path}`, {
    method,
    headers: {
      "x-shopify-access-token": cfg.shopToken,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Admin GraphQL: mark a Shopify order as paid (creates a "sale" transaction). */
async function shopifyMarkPaid(orderId) {
  const r = await fetchJson(`https://${cfg.shopDomain}/admin/api/${cfg.shopApiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "x-shopify-access-token": cfg.shopToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation markPaid($id: ID!) { orderMarkAsPaid(input: {id: $id}) {
        order { id } userErrors { field message } } }`,
      variables: { id: `gid://shopify/Order/${orderId}` },
    }),
  });
  const errs = r.json?.data?.orderMarkAsPaid?.userErrors ?? [];
  return { ok: r.ok && errs.length === 0, errors: errs, status: r.status };
}

/** Append to the order note — the buyer never misses the payment link. */
async function appendOrderNote(orderId, line) {
  const cur = await shopifyRest("GET", `orders/${orderId}.json?fields=id,note`);
  const prev = cur.json?.order?.note ?? "";
  if (prev.includes(line)) return;
  const note = (prev ? prev + "\n" : "") + line;
  await shopifyRest("PUT", `orders/${orderId}.json`, { order: { id: orderId, note } });
}

/** Mint or reuse the LibrePay invoice for a Shopify order (idempotent). */
async function ensureInvoice(order) {
  const key = String(order.id);
  const existing = state[key];
  if (existing?.checkoutUrl && !existing.expired) {
    return existing;
  }
  const attempt = existing?.attempt ?? 0;
  const payload = {
    amountFiat: Number(order.current_total_price),
    currency: String(order.currency ?? "USD"),
    orderId: `shopify:${order.id}:${order.name ?? ""}`.slice(0, 64),
    description: `Shopify order ${order.name ?? order.id}`.slice(0, 140),
    metadata: {
      shop: cfg.shopDomain,
      shopifyOrderId: String(order.id),
      shopifyOrderNumber: String(order.order_number ?? ""),
    },
  };
  const r = await fetchJson(`${cfg.nodeUrl}/api/v1/invoices`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.nodeKey}`,
      "content-type": "application/json",
      "idempotency-key": `shopify-${order.id}-${order.test ? "t" : "r"}-${attempt}`,
    },
    body: JSON.stringify(payload),
  });
  if (r.status !== 201 || !r.json?.invoice?.id) {
    throw new Error(`invoice create failed HTTP ${r.status}: ${(r.text ?? "").slice(0, 200)}`);
  }
  const entry = {
    invoiceId: r.json.invoice.id,
    checkoutUrl: r.json.checkoutUrl ?? `${cfg.nodeUrl}/pay/${r.json.invoice.id}`,
    attempt,
    expired: false,
    markedPaid: existing?.markedPaid ?? false,
    cancelled: existing?.cancelled ?? false,
    currency: payload.currency,
    amountFiat: payload.amountFiat,
  };
  state[key] = entry;
  persist();
  return entry;
}

function orderMatchesGateway(order) {
  const names = (order.payment_gateway_names ?? []).map((n) => String(n).toLowerCase());
  return names.some((n) => cfg.gatewayMatch.some((m) => n.includes(m)));
}

// ── HTTP server ──────────────────────────────────────────────────────────────
mkdirSync(dirname(cfg.stateFile), { recursive: true });

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  const url = new URL(req.url ?? "/", "http://local");

  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "librepay-shopify-bridge", shop: cfg.shopDomain }));
      return;
    }

    // ── Shopify → bridge ────────────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/webhooks/shopify") {
      if (cfg.shopWebhookSecret) {
        const got = String(req.headers["x-shopify-hmac-sha256"] ?? "");
        const want = createHmac("sha256", cfg.shopWebhookSecret).update(raw, "utf8").digest("base64");
        if (!safeEqual(got, want)) {
          log("shopify webhook: BAD HMAC");
          res.writeHead(401).end("bad hmac");
          return;
        }
      } else {
        log("WARN: SHOPIFY_WEBHOOK_SECRET unset — HMAC verification skipped");
      }
      const topic = String(req.headers["x-shopify-topic"] ?? "");
      const order = JSON.parse(raw || "{}");

      if (topic === "orders/cancelled") {
        const key = String(order.id ?? "");
        if (state[key]) {
          state[key].cancelled = true;
          persist();
          log(`order ${order.name ?? key} cancelled — invoice parked (refund manually from your wallet if paid)`);
        }
        res.writeHead(200).end("ok");
        return;
      }
      if (topic !== "orders/create" && topic !== "orders/updated") {
        res.writeHead(200).end("ignored topic");
        return;
      }
      if (!orderMatchesGateway(order)) {
        res.writeHead(200).end("not our gateway");
        return;
      }

      const entry = await ensureInvoice(order);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, invoiceId: entry.invoiceId }));

      // slow, best-effort: payment link into the order note
      const link = `${cfg.baseUrl || "http://YOUR-BRIDGE"}${"/pay/"}${order.id}`;
      appendOrderNote(
        order.id,
        `Bitcoin (LibrePay): pay at ${entry.checkoutUrl} — invoice ${entry.invoiceId}. Fallback link: ${link}`
      ).then(() => log(`order ${order.name ?? order.id} ← note with invoice ${entry.invoiceId}`))
       .catch((e) => log("note append failed:", e.message));
      return;
    }

    // ── LibrePay node → bridge ──────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/webhooks/librepay") {
      const sig = String(req.headers["x-librepay-signature"] ?? "");
      if (!cfg.nodeSecret || !safeEqual(hmacHex(cfg.nodeSecret, raw), sig)) {
        log("librepay webhook: BAD SIGNATURE");
        res.writeHead(401).end("bad signature");
        return;
      }
      const ts = Number(req.headers["x-librepay-timestamp"] ?? 0);
      if (ts && Math.abs(Date.now() - ts) > 10 * 60_000) {
        res.writeHead(400).end("stale");
        return;
      }
      const evt = JSON.parse(raw || "{}");
      const deliveryId = String(req.headers["x-librepay-delivery-id"] ?? `${evt.invoiceId}:${evt.event}`);
      const dedupeKey = "dlv:" + deliveryId;
      if (state[dedupeKey]) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, duplicate: true }));
        return;
      }

      if (evt.event === "invoice.confirmed" || evt.event === "invoice.settled") {
        const found = Object.entries(state).find(
          ([, v]) => v && typeof v === "object" && v.invoiceId === evt.invoiceId
        );
        if (found && !found[1].markedPaid && !found[1].cancelled) {
          const [orderId, entry] = found;
          const r = await shopifyMarkPaid(orderId);
          if (r.ok) {
            entry.markedPaid = true;
            state[dedupeKey] = true;
            persist();
            log(`order ${orderId} MARKED PAID (${evt.event}, invoice ${evt.invoiceId})`);
          } else {
            log("orderMarkAsPaid errors:", JSON.stringify(r.errors ?? r.status));
            // no dedupe on failure — the node's retry schedule re-delivers
            res.writeHead(500).end("mark failed");
            return;
          }
        }
      } else {
        state[dedupeKey] = true;
        persist();
      }
      res.writeHead(200).end("ok");
      return;
    }

    // ── buyer fallback link: /pay/{orderId} ─────────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith("/pay/")) {
      const ref = decodeURIComponent(url.pathname.slice(5)).trim().replace(/^#/, "");
      let entry = state[ref] ?? null;
      if (!entry && /^\d+$/.test(ref)) {
        // lazy mint: pull the order from Shopify, then create the invoice
        const r = await shopifyRest("GET", `orders/${ref}.json`);
        if (r.ok && r.json?.order) {
          entry = await ensureInvoice(r.json.order);
        }
      }
      if (entry?.checkoutUrl) {
        res.writeHead(302, { location: entry.checkoutUrl }).end();
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" }).end("unknown order — complete checkout first");
      return;
    }

    res.writeHead(404).end("not found");
  } catch (err) {
    log("error:", err?.message ?? err);
    res.writeHead(500).end("bridge error");
  }
}).listen(cfg.port, () => {
  log(`librepay-shopify bridge on :${cfg.port}`);
  log(`  shop   : ${cfg.shopDomain}`);
  log(`  node   : ${cfg.nodeUrl}`);
  log(`  state  : ${cfg.stateFile}`);
  log(`  hmac   : ${cfg.shopWebhookSecret ? "enabled" : "DISABLED (set SHOPIFY_WEBHOOK_SECRET)"}`);
});
