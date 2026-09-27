/**
 * TEST-ONLY payment simulator (LP_SIMULATE=true) — and only outside production.
 * Fabricates a mempool→confirmed→settled flow for an invoice so the FULL
 * lifecycle (state machine, webhooks, dashboard, checkout UI) can be tested
 * end-to-end without a live chain. Never enabled in production.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { simulatePaymentSchema } from "@/lib/validation";
import { transitionInvoice } from "@/lib/server/invoice-events";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Fail closed TWICE: the flag must be on AND the process must not be in
 * production. A PAYMENT_SIMULATION=true misconfig in prod can never forge
 * settled invoices or fire invoice.* webhooks.
 */
function gate(req: Request): NextResponse | null {
  if (!env.SIMULATE || env.NODE_ENV === "production") {
    return NextResponse.json({ error: "simulation_disabled" }, { status: 404 });
  }
  const rl = rateLimit(`simulate:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  return null;
}

export async function POST(req: Request) {
  const denied = gate(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const parsed = simulatePaymentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const invoice = await db.invoice.findUnique({ where: { id: parsed.data.invoiceId } });
  if (!invoice) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (["settled", "expired"].includes(invoice.status)) {
    return NextResponse.json({ error: "invoice_terminal", status: invoice.status }, { status: 409 });
  }

  const txid = fakeTxid();
  const paid = parsed.data.underpay
    ? BigInt(Math.max(1, Math.floor(Number(invoice.amountSats) / 2)))
    : invoice.amountSats;

  // Lightning simulation: instant settle (no confirmations by design)
  if (parsed.data.method === "lightning") {
    if (!invoice.lightningPaymentRequest) {
      return NextResponse.json({ error: "no_lightning_rail" }, { status: 409 });
    }
    await transitionInvoice(invoice.id, {
      status: "settled",
      receivedSats: invoice.amountSats,
      paidVia: "lightning",
      lightningPaidAt: new Date(),
      paidAt: new Date(),
      settledAt: new Date(),
    });
    return NextResponse.json({ ok: true, method: "lightning", status: "settled" });
  }

  // 1) mempool detection (0 conf)
  await transitionInvoice(invoice.id, { status: "detected", txid, receivedSats: paid, confirmations: 0, paidVia: "onchain" });
  // 2) confirmed
  await transitionInvoice(invoice.id, { status: "confirmed", confirmations: Math.max(invoice.confirmationsRequired, 2), paidAt: new Date() });

  return NextResponse.json({ ok: true, txid, status: "confirmed" });
}

export async function PATCH(req: Request) {
  // simulate settlement (deep confirmations)
  const denied = gate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const parsed = simulatePaymentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const invoice = await db.invoice.findUnique({ where: { id: parsed.data.invoiceId } });
  if (!invoice) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await transitionInvoice(invoice.id, {
    status: "settled",
    confirmations: Math.max(6, invoice.confirmationsRequired + 4),
    settledAt: new Date(),
  });
  return NextResponse.json({ ok: true, status: "settled" });
}

function fakeTxid(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
