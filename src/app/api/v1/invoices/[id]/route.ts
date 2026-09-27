/**
 * Public merchant API v1 — fetch invoice status by id (API-key scoped).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateApiKey } from "@/lib/server/api-auth";
import { serializeInvoice } from "@/lib/serialize";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const invoice = await db.invoice.findFirst({ where: { id, merchantId: auth.merchantId } });
  if (!invoice) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ invoice: serializeInvoice(invoice) });
}
