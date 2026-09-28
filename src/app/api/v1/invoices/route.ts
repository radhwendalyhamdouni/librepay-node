/**
 * Public merchant API v1 — Bearer API-key auth.
 *
 *   POST /api/v1/invoices   → create invoice
 *   GET  /api/v1/invoices/:id → invoice status
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateApiKey } from "@/lib/server/api-auth";
import { createInvoiceForMerchant, InvoiceError, checkoutUrlFor } from "@/lib/server/invoice-service";
import { getMerchant } from "@/lib/config";
import { serializeInvoice } from "@/lib/serialize";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rl = rateLimit(`v1inv:${auth.merchantId}:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  try {
    const merchant = getMerchant();

    // Stripe-style idempotency: send `Idempotency-Key: <your-unique-token>`
    // and network retries can never create a second invoice for one order.
    const rawKey = (req.headers.get("idempotency-key") ?? "").trim();
    if (rawKey.length > 128) {
      return NextResponse.json({ error: "INVALID_INPUT", detail: "Idempotency-Key too long (max 128)" }, { status: 400 });
    }
    const idempotencyKey = rawKey || undefined;

    const body = await req.json().catch(() => ({}));
    const { id, replayed } = await createInvoiceForMerchant(merchant, body, req, { idempotencyKey });
    const invoice = await db.invoice.findUnique({ where: { id } });
    return NextResponse.json(
      {
        invoice: invoice ? serializeInvoice(invoice) : null,
        checkoutUrl: checkoutUrlFor(req, id),
      },
      {
        status: 201,
        headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
      }
    );
  } catch (e) {
    if (e instanceof InvoiceError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[api/v1/invoices]", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
