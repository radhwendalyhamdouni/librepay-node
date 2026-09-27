import type { Invoice } from "@prisma/client";

/**
 * BigInt-safe serializers (sats are BigInt in the DB; JSON can't hold BigInt).
 * Sats are serialized as strings to avoid JS number precision loss.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type InvoiceDTO = ReturnType<typeof serializeInvoice>;

export function serializeInvoice(inv: Invoice) {
  return {
    id: inv.id,
    merchantId: inv.merchantId,
    amountSats: inv.amountSats.toString(),
    receivedSats: inv.receivedSats.toString(),
    fiatCurrency: inv.fiatCurrency,
    fiatAmountCents: inv.fiatAmountCents,
    satsPerUnit: inv.satsPerUnit,
    derivationMode: inv.derivationMode,
    stealthAddress: inv.stealthAddress,
    ephemeralPub: inv.ephemeralPub,
    paymentCode: inv.paymentCodeSnapshot,
    derivationIndex: inv.derivationIndex,
    orderId: inv.orderId,
    description: inv.description,
    metadata: inv.metadata,
    buyerLang: inv.buyerLang,
    status: inv.status,
    txid: inv.txid,
    confirmations: inv.confirmations,
    confirmationsRequired: inv.confirmationsRequired,
    refundStatus: inv.refundStatus,
    payerAddress: inv.payerAddress,
    expiresAt: inv.expiresAt.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    settledAt: inv.settledAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
}
