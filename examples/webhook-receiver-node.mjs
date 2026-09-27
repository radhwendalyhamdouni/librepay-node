/**
 * LibrePay Node — webhook receiver (Express, production-grade pattern).
 *
 *   npm i express && LIBREPAY_WEBHOOK_SECRET=whsec_… node examples/webhook-receiver-node.mjs
 *
 * Non-negotiables implemented here:
 *   1. Verify the HMAC against the RAW body, timing-safe, BEFORE parsing JSON.
 *   2. Replay guard — reject events older than 10 minutes (X-LibrePay-Timestamp).
 *   3. Idempotency — the same delivery may arrive more than once.
 *   4. Answer 2xx fast; do slow work after responding (or in a queue).
 */

import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const app = express();
const SECRET = process.env.LIBREPAY_WEBHOOK_SECRET ?? "";
const seen = new Set(); // real deployments: persist this (redis/db), not a Set

app.post(
  "/api/webhooks/librepay",
  express.raw({ type: "*/*", limit: "256kb" }), // NOT express.json() — raw body is what we sign
  (req, res) => {
    const sig = String(req.header("x-librepay-signature") ?? "");
    const expected = "sha256=" + createHmac("sha256", SECRET).update(req.body).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(400).send("bad signature");
    }

    // replay guard (header is unix ms, sent by the node)
    const ts = Number(req.header("x-librepay-timestamp") ?? 0);
    if (!ts || Math.abs(Date.now() - ts) > 10 * 60_000) {
      return res.status(400).send("stale timestamp");
    }

    const evt = JSON.parse(req.body.toString("utf8"));
    const deliveryId = req.header("x-librepay-delivery-id") ?? `${evt.invoiceId}:${evt.event}`;
    if (seen.has(deliveryId)) return res.status(200).end(); // duplicate — already processed
    seen.add(deliveryId);

    switch (evt.event) {
      case "invoice.detected": // transaction seen in mempool — show "confirming"
        break;
      case "invoice.confirmed": // ✅ 2 confirmations (or instant Lightning) — RELEASE THE GOODS
        console.log("order paid:", evt.invoiceId, evt.data?.invoice?.orderId ?? "");
        // mark order paid / ship / unlock — keyed by evt.invoiceId or metadata.orderId
        break;
      case "invoice.settled": // 6+ confirmations — deep finality
        break;
      case "invoice.expired": // buyer never paid — reopen the order
        break;
      case "invoice.underpaid": // paid less than 99% — review manually
        break;
    }

    res.status(200).end(); // acknowledge; non-2xx triggers the retry schedule
  }
);

app.listen(8080, () => console.log("listening on :8080 — register this URL as LP_WEBHOOK_URLS"));
