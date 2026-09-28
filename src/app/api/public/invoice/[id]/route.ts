/**
 * PUBLIC checkout payload — public-by-link, minimal data exposure.
 * Returns only what the payment page needs. No emails, no order metadata
 * beyond description, no operator internals. Branding comes from .env —
 * there is no merchant table in the node edition.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { bip21Uri } from "@/lib/bitcoin";
import { getMerchant } from "@/lib/config";
import { env } from "@/lib/env";
import { explorerPathFor } from "@/lib/network";

/**
 * Block-explorer base derived from the operator's OWN Esplora setting —
 * running a self-hosted mempool instance means even the "view on explorer"
 * links stay inside infrastructure the operator controls. Non-mempool or
 * malformed ESPLORA_API values fall back to mempool.space. On a testnet
 * node the /testnet4 path is appended so tx links resolve on the right chain.
 */
function explorerTxBase(): string {
  const netPath = explorerPathFor(env.NETWORK);
  try {
    const u = new URL(env.ESPLORA_API);
    return `${u.protocol}//${u.host}${netPath}`;
  } catch {
    return `https://mempool.space${netPath}`;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rl = rateLimit(`pubinv:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { id } = await params;
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const me = getMerchant();
  return NextResponse.json({
    invoice: {
      id: invoice.id,
      status: invoice.status,
      amountSats: invoice.amountSats.toString(),
      receivedSats: invoice.receivedSats.toString(),
      fiatCurrency: invoice.fiatCurrency,
      fiatAmountCents: invoice.fiatAmountCents,
      description: invoice.description,
      orderId: invoice.orderId,
      address: invoice.stealthAddress,
      paymentUri: bip21Uri(invoice.stealthAddress, invoice.amountSats, me.name, invoice.description ?? undefined),
      lightningPaymentRequest: invoice.lightningPaymentRequest,
      lightningAvailable: !!invoice.lightningPaymentRequest,
      paidVia: invoice.paidVia,
      txid: invoice.txid,
      confirmations: invoice.confirmations,
      confirmationsRequired: invoice.confirmationsRequired,
      expiresAt: invoice.expiresAt.toISOString(),
      buyerLang: invoice.buyerLang,
      refundStatus: invoice.refundStatus,
      refundTxid: null,
      refundDeclineReason: null,
      refundsEnabled: false, // manual refunds happen straight from the operator wallet
      refundWindowDays: 0,
      explorerTxBase: explorerTxBase(),
      merchant: {
        name: me.name,
        brandColor: me.brandColor,
        logoUrl: me.logoUrl,
      },
    },
  });
}
