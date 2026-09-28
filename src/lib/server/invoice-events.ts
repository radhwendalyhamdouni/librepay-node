/**
 * Invoice lifecycle state machine + payment watcher (cron core).
 *
 *   waiting ──(tx in mempool)──▶ detected (0 conf)
 *   detected ──(>= N conf)────▶ confirmed
 *   confirmed ──(>= N+4 conf, min 6)──▶ settled
 *   waiting/detected ──(past expiry, no tx)──▶ expired
 *   tx underpays beyond the 1% tolerance after confirmations ──▶ underpaid
 *
 * Every transition fires HMAC-signed webhooks: invoice.detected / confirmed /
 * settled / expired / underpaid.
 */

import { db } from "@/lib/db";
import { isWithinUnderpaymentTolerance } from "@/lib/bitcoin";
import { getTipHeight, getAddressTxs, amountPaidToAddress, confirmationsOf, payerAddressOf, type EsploraTx } from "./esplora";
import { isChainDown } from "./chain-health";
import { enqueueWebhooks, processPendingDeliveries } from "./webhook";
import { phoenixdGetIncoming, lightningPasswordOf } from "./lightning";
import { notifyMerchant, notifyAdmins } from "./notify";
import { getMerchant } from "@/lib/config";
import type { Invoice } from "@prisma/client";

export const SETTLED_CONF_MIN = 6;

function publicInvoiceData(inv: Invoice) {
  return {
    id: inv.id,
    status: inv.status,
    amountSats: inv.amountSats.toString(),
    receivedSats: inv.receivedSats.toString(),
    orderId: inv.orderId,
    description: inv.description,
    currency: inv.fiatCurrency,
    fiatAmountCents: inv.fiatAmountCents,
    txid: inv.txid,
    confirmations: inv.confirmations,
    confirmationsRequired: inv.confirmationsRequired,
    paymentMethod: inv.paidVia ?? "onchain",
    expiresAt: inv.expiresAt.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    settledAt: inv.settledAt?.toISOString() ?? null,
  };
}

/**
 * Persist a status transition (idempotent — never moves backwards).
 *
 * ATOMIC COMPARE-AND-SET + TRANSACTIONAL OUTBOX: the status write and the
 * webhook queueing share ONE SQLite transaction. If enqueueing fails, the
 * status change rolls back too and the next cron tick retries the whole
 * transition — a shop can never miss a payment notification because of a
 * crash in between. Two concurrent ticks still cannot double-fire.
 * Emits: invoice.detected / confirmed / settled / expired / underpaid.
 */
export async function transitionInvoice(
  invoiceId: string,
  patch: { status?: string; txid?: string | null; receivedSats?: bigint; confirmations?: number; paidAt?: Date; settledAt?: Date; payerAddress?: string | null; paidVia?: "onchain" | "lightning"; lightningPaidAt?: Date; confirmedStreak?: number }
): Promise<Invoice | null> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return null;

  const ORDER: Record<string, number> = { waiting: 0, detected: 1, confirmed: 2, settled: 3 };
  const data: Record<string, unknown> = { ...patch };
  const events: string[] = [];

  if (patch.status && patch.status !== inv.status) {
    const from = ORDER[inv.status] ?? 0;
    const to = ORDER[patch.status] ?? 0;
    if (patch.status === "expired" && (inv.status === "waiting" || inv.status === "detected")) {
      // expiry is allowed from open states (event fires once — expiredNotified flag)
      if (!inv.expiredNotified) {
        data.status = "expired";
        data.expiredNotified = true;
        events.push("invoice.expired");
      }
    } else if (patch.status === "underpaid" && !(inv.status === "settled" || inv.status === "expired" || inv.status === "underpaid")) {
      if (!inv.underpaidNotified) {
        data.status = "underpaid";
        data.underpaidNotified = true;
        events.push("invoice.underpaid");
      }
    } else if (inv.status === "expired" || inv.status === "underpaid") {
      if (patch.status === "detected" || patch.status === "confirmed" || patch.status === "settled") {
        // late payment on expired/underpaid invoice: upgrade status
        data.status = patch.status;
        if (patch.status === "confirmed") events.push("invoice.confirmed");
        if (patch.status === "settled") events.push("invoice.settled");
      }
    } else if (to > from) {
      data.status = patch.status;
      if (patch.status === "detected") events.push("invoice.detected");
      if (patch.status === "confirmed") events.push("invoice.confirmed");
      if (patch.status === "settled") events.push("invoice.settled");
    } else {
      delete data.status; // never move backwards
    }
  }

  if (Object.keys(data).length === 0) return inv;

  // one transaction = status change + its webhook rows (see docblock above)
  const updated = await db.$transaction(async (tx) => {
    // atomic compare-and-set: only write if status is still what we read
    const res = await tx.invoice.updateMany({
      where: { id: invoiceId, status: inv.status },
      data,
    });
    if (res.count === 0) return null; // a concurrent writer already transitioned
    const row = (await tx.invoice.findUnique({ where: { id: invoiceId } })) as Invoice;
    for (const ev of events) {
      await enqueueWebhooks(tx, inv.merchantId, ev, inv.id, { invoice: publicInvoiceData(row) });
    }
    return row;
  });
  if (updated === null) {
    // concurrent writer won — return current row, fire nothing
    return db.invoice.findUnique({ where: { id: invoiceId } });
  }
  if (events.includes("invoice.settled")) {
    // in-app bell for the merchant — one hook covers ALL rails (on-chain,
    // lightning, manual, simulate) because every settlement funnels through
    // this state machine. Never blocks the payment flow.
    void notifyMerchant(
      updated.merchantId,
      "payment_settled",
      { sats: updated.receivedSats.toString(), order: updated.orderId },
      `/dashboard/invoices?invoice=${updated.id}`
    ).catch((err) => console.error("[notify] payment_settled", err));
  }
  return updated;
}

/** One cron pass over open invoices. Returns summary. */
export async function checkOpenInvoices(): Promise<{
  checked: number; detected: number; confirmed: number; settled: number; expired: number; errors: number; chainDown: boolean;
}> {
  // OUTAGE-AWARE: this tip probe doubles as the outage probe. While the
  // provider is DOWN the whole pass costs exactly ONE HTTP call per tick —
  // the moment it answers again, the full pass resumes on the same tick.
  const tip = await getTipHeight();
  if (tip === null) {
    // No chain data → NEVER touch payment metadata (a missing tip would
    // zero every confirmation and reset reorg streaks — data regression).
    // Time-based expiry below needs no chain data and stays correct: late
    // payments still upgrade expired invoices via the existing path.
    const summary = { checked: 0, detected: 0, confirmed: 0, settled: 0, expired: 0, errors: 1, chainDown: true };
    await expireStaleInvoices(summary);
    return summary;
  }
  const open = await db.invoice.findMany({
    where: { status: { in: ["waiting", "detected", "confirmed"] } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const summary = { checked: 0, detected: 0, confirmed: 0, settled: 0, expired: 0, errors: 0, chainDown: false };
  const now = new Date();

  for (const inv of open) {
    // provider fell mid-pass (address calls failing) — stop hammering it;
    // the health monitor is already counting and will raise the alarm
    if (isChainDown()) { summary.errors++; break; }
    summary.checked++;
    try {
      const txs = await getAddressTxs(inv.stealthAddress);
      if (txs === null) { summary.errors++; continue; }

      // Sum ALL payments to this (invoice-unique) stealth address — buyers may
      // split the total across several transactions. The highest-confirmation
      // tx provides txid/confirmations/payer metadata.
      let total = 0n;
      let chosen: EsploraTx | null = null;
      let chosenConf = -1;
      for (const tx of txs) {
        const paid = amountPaidToAddress(tx, inv.stealthAddress);
        if (paid <= 0) continue;
        total += BigInt(paid);
        const c = confirmationsOf(tx, tip ?? 0);
        if (c > chosenConf) { chosenConf = c; chosen = tx; }
      }

      if (!chosen || total <= 0n) {
        if (inv.status !== "confirmed" && inv.expiresAt < now && inv.status !== "settled") {
          await transitionInvoice(inv.id, { status: "expired" });
          summary.expired++;
        }
        continue;
      }

      const conf = chosenConf;
      const patch: Parameters<typeof transitionInvoice>[1] = {
        txid: chosen.txid,
        receivedSats: total,
        confirmations: conf,
      };
      // capture payment origin once (used for optional refund-to-origin)
      if (!inv.payerAddress) {
        const payer = payerAddressOf(chosen);
        if (payer) patch.payerAddress = payer;
      }

      // shortfalls within the 1% tolerance count as fully paid — buyer-side
      // wallets routinely shave a few sats for their own fees
      const underpaid = total < inv.amountSats && !isWithinUnderpaymentTolerance(total, inv.amountSats);
      if (underpaid && (conf >= inv.confirmationsRequired || (!chosen.status.confirmed && inv.status === "waiting"))) {
        patch.status = conf >= inv.confirmationsRequired ? "underpaid" : "detected";
      } else if (conf === 0) {
        patch.status = "detected";
      } else if (conf >= Math.max(SETTLED_CONF_MIN, inv.confirmationsRequired + 4)) {
        patch.status = "settled";
        patch.settledAt = new Date();
      } else if (conf >= inv.confirmationsRequired) {
        // REORG GUARD: a confirmed-level sighting must REPEAT on the next
        // tick (~30s later) before the invoice flips. One Esplora hiccup or
        // a shallow reorg can no longer fire a false invoice.confirmed.
        // (Lightning skips this — instant settlement has no blocks to reorg.)
        if (inv.status === "confirmed" || inv.status === "settled") {
          // already past the gate — keep refreshing metadata only
        } else {
          const streak = (inv.confirmedStreak ?? 0) + 1;
          if (streak >= 2) {
            patch.status = "confirmed";
            patch.paidAt = new Date();
            patch.confirmedStreak = streak;
          } else {
            patch.status = "detected";
            patch.confirmedStreak = streak;
          }
        }
      } else {
        patch.status = "detected";
      }
      // confirmations dropped below the bar (reorg/fee chase) — reset the gate
      if (conf < inv.confirmationsRequired) patch.confirmedStreak = 0;

      const before = inv.status;
      let after: Invoice | null;
      if (patch.status === "settled" && (before === "waiting" || before === "detected")) {
        // long tick gap: confirmations jumped straight past the confirmed
        // threshold. Still emit BOTH events in contract order — shops release
        // goods on invoice.confirmed and must not miss it.
        await transitionInvoice(inv.id, {
          ...patch,
          status: "confirmed",
          settledAt: undefined,
          paidAt: patch.paidAt ?? new Date(),
        });
        summary.confirmed++;
        after = await transitionInvoice(inv.id, { status: "settled", settledAt: new Date() });
      } else {
        after = await transitionInvoice(inv.id, patch);
      }
      if (after) {
        if (before === "waiting" && after.status === "detected") summary.detected++;
        if (after.status === "confirmed" && before !== "confirmed" && before !== "settled") summary.confirmed++;
        if (after.status === "settled" && before !== "settled") summary.settled++;
        // invoice.underpaid / invoice.expired events now fire inside
        // transitionInvoice itself (once, guarded by the notified flags).
      }
    } catch (err) {
      console.error("[checkOpenInvoices]", inv.id, err);
      summary.errors++;
    }
  }

  // expire stale invoices that were never touched above (no API errors)
  // — fetch affected rows first so invoice.expired webhooks fire exactly once
  await expireStaleInvoices(summary);

  return summary;
}

/**
 * Time-based expiry — safe to run even with NO chain data (needs nothing
 * from the provider, so it keeps running during a full Esplora outage).
 * One transaction per invoice: status + its webhook rows (outbox).
 */
async function expireStaleInvoices(summary: { expired: number }): Promise<void> {
  const staleRows = await db.invoice.findMany({
    where: { status: { in: ["waiting", "detected"] }, expiresAt: { lt: new Date() }, expiredNotified: false },
    take: 500,
  });
  if (staleRows.length === 0) return;
  for (const inv of staleRows) {
    const ok = await db
      .$transaction(async (tx) => {
        const res = await tx.invoice.updateMany({
          where: { id: inv.id, status: { in: ["waiting", "detected"] }, expiredNotified: false },
          data: { status: "expired", expiredNotified: true },
        });
        if (res.count === 0) return false;
        await enqueueWebhooks(tx, inv.merchantId, "invoice.expired", inv.id, {
          invoice: publicInvoiceData({ ...inv, status: "expired", expiredNotified: true }),
        });
        return true;
      })
      .catch((err) => {
        console.error("[expire-outbox]", inv.id, err);
        return false;
      });
    if (ok) summary.expired++;
  }
}

/**
 * Cron pass over open LIGHTNING invoices (merchant phoenixd nodes).
 * Primary signal is the phoenixd webhook; this polling loop is the safety
 * net that catches missed webhooks. Settlement is INSTANT — no confirmations.
 */
export async function checkLightningInvoices(): Promise<{ checked: number; settled: number; errors: number }> {
  const open = await db.invoice.findMany({
    where: {
      status: { in: ["waiting", "detected"] },
      lightningPaymentHash: { not: null },
      expiresAt: { gt: new Date(Date.now() - 60 * 60_000) }, // keep watching ≤1h past expiry for late lightning pays
    },
    // node edition: phoenixd comes from config, not a merchant row
    orderBy: { createdAt: "asc" },
    take: 60,
  });

  let settled = 0;
  let errors = 0;
  const me = getMerchant();
  for (const inv of open) {
    const lightningUrl = me.lightningUrl;
    const password = lightningPasswordOf({ lightningPasswordEnc: null });
    if (!lightningUrl || !password || !inv.lightningPaymentHash) continue;
    try {
      const incoming = await phoenixdGetIncoming(lightningUrl, password, inv.lightningPaymentHash);
      if (incoming && incoming.completedAt) {
        await transitionInvoice(inv.id, {
          status: "settled",
          receivedSats: inv.amountSats,
          paidVia: "lightning",
          lightningPaidAt: new Date(),
          paidAt: new Date(),
          settledAt: new Date(),
        });
        settled++;
      }
    } catch (err) {
      console.error("[checkLightningInvoices]", inv.id, err);
      errors++;
    }
  }
  return { checked: open.length, settled, errors };
}

/** Full cron tick — invoices + lightning + subscriptions + webhook retries. */
export async function cronTick() {
  const invoices = await checkOpenInvoices();
  const lightning = await checkLightningInvoices();
  const webhooks = await processPendingDeliveries();
  return { invoices, lightning, webhooks };
}
