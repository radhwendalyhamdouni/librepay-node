/**
 * Outbox sanity: transition an invoice and confirm its webhook deliveries
 * were queued in the SAME transaction. Run: bun scripts/test-outbox.ts <invoiceId>
 */
import { db } from "../src/lib/db";
import { transitionInvoice } from "../src/lib/server/invoice-events";

const id = process.argv[2];
if (!id) { console.error("usage: bun scripts/test-outbox.ts <invoiceId>"); process.exit(1); }

const before = await db.webhookDelivery.count({ where: { invoiceId: id } });
const inv = await transitionInvoice(id, {
  status: "detected",
  txid: "outbox-test-" + Date.now(),
  receivedSats: 21000n,
  confirmations: 0,
});
const after = await db.webhookDelivery.count({ where: { invoiceId: id } });
const deliveries = await db.webhookDelivery.findMany({
  where: { invoiceId: id },
  select: { event: true, status: true, attempts: true },
  orderBy: { createdAt: "desc" },
  take: 5,
});
console.log(JSON.stringify({ status: inv?.status, deliveriesBefore: before, deliveriesAfter: after, recent: deliveries }, null, 2));
await db.$disconnect();
