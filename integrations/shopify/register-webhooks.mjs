#!/usr/bin/env node
/**
 * One-shot: register the Shopify webhooks that feed the LibrePay bridge.
 *
 *   SHOPIFY_STORE_DOMAIN=myshop.myshopify.com \
 *   SHOPIFY_ADMIN_TOKEN=shpat_… \
 *   BASE_URL=https://bridge.example.com \
 *   node register-webhooks.mjs
 */

const domain = (process.env.SHOPIFY_STORE_DOMAIN ?? "").replace(/^https?:\/\//, "");
const token = process.env.SHOPIFY_ADMIN_TOKEN ?? "";
const base = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const version = process.env.SHOPIFY_API_VERSION ?? "2024-10";

if (!domain || !token || !base) {
  console.error("usage: SHOPIFY_STORE_DOMAIN=… SHOPIFY_ADMIN_TOKEN=… BASE_URL=https://bridge.example.com node register-webhooks.mjs");
  process.exit(1);
}

const topics = ["orders/create", "orders/updated", "orders/cancelled"];

async function api(path, body) {
  const res = await fetch(`https://${domain}/admin/api/${version}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-shopify-access-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const list = await api("webhooks.json?limit=100");
console.log("existing webhooks:", JSON.stringify(list.json?.webhooks?.map((w) => `${w.topic} → ${w.address}`) ?? list.json, null, 2));

for (const topic of topics) {
  const r = await api("webhooks.json", {
    webhook: { topic, address: `${base}/webhooks/shopify`, format: "json" },
  });
  const err = r.json?.errors;
  console.log(`${r.status === 201 ? "✓" : "✗"} ${topic} → ${base}/webhooks/shopify${err ? " — " + JSON.stringify(err) : ""}`);
}
