/**
 * Invoice creation + lookup service (shared by dashboard API and public v1 API).
 */

import { db } from "@/lib/db";
import { createInvoiceSchema, type CreateInvoiceInput } from "@/lib/validation";
import { deriveInvoiceAddress, deriveWatchOnlyAddress } from "./derive";
import { getFiatRates } from "./esplora";
import { FALLBACK_RATES } from "./fallback-rates";
import { fiatToSats, SUPPORTED_CURRENCIES } from "@/lib/bitcoin";
import { phoenixdCreateInvoice, lightningPasswordOf, PhoenixdError } from "./lightning";
import type { MerchantConfig } from "@/lib/config";
import { env } from "@/lib/env";
import { detectLang } from "@/lib/i18n";
import { getSettings } from "@/lib/server/settings";

/** live rate if reachable, otherwise static fallback (checkout must keep working) */
async function rateFor(currency: string): Promise<number | null> {
  const live = (await getFiatRates())?.[currency];
  if (live && live > 0) return live;
  const fb = FALLBACK_RATES[currency];
  return fb && fb > 0 ? fb : null;
}

export class InvoiceError extends Error {
  constructor(public code: string, public httpStatus = 400) {
    super(code);
  }
}

export async function createInvoiceForMerchant(
  merchant: MerchantConfig,
  rawInput: unknown,
  req?: Request,
  opts?: { idempotencyKey?: string }
): Promise<{ id: string; replayed: boolean }> {
  // ── idempotent replay (Idempotency-Key header) ──
  // Same key → the SAME invoice comes back, no double creation, no double
  // address churn. Backed by a UNIQUE (merchantId, idempotencyKey) index, so
  // even two truly concurrent requests cannot both win: the loser hits the
  // constraint and is served the winner's invoice.
  const idemKey = opts?.idempotencyKey;
  if (idemKey) {
    const existing = await db.invoice.findFirst({
      where: { merchantId: merchant.id, idempotencyKey: idemKey },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (existing) return { id: existing.id, replayed: true };
  }

  const parsed = createInvoiceSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new InvoiceError(`INVALID_INPUT: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const input: CreateInvoiceInput = parsed.data;

  // ---- wallet readiness (the node has no plans — unlimited by design) ----
  if (merchant.walletMode === "none" || (!merchant.paymentCode && !merchant.accountXpub)) {
    throw new InvoiceError("WALLET_NOT_CONFIGURED", 409);
  }

  // ---- amount resolution ----
  let amountSats: number;
  let fiatCurrency: string | null = null;
  let fiatAmountCents: number | null = null;
  let satsPerUnit: string | null = null;

  if (input.amountSats !== undefined) {
    amountSats = input.amountSats;
    if (input.currency) {
      fiatCurrency = input.currency;
      const fiatPerBtc = await rateFor(input.currency);
      if (fiatPerBtc) {
        fiatAmountCents = Math.round((amountSats / 1e8) * fiatPerBtc * 100);
        satsPerUnit = String(fiatPerBtc);
      }
    }
  } else {
    fiatCurrency = input.currency!;
    fiatAmountCents = Math.round(input.amountFiat! * 100);
    if (!SUPPORTED_CURRENCIES.includes(fiatCurrency as (typeof SUPPORTED_CURRENCIES)[number])) {
      throw new InvoiceError("UNSUPPORTED_CURRENCY");
    }
    const fiatPerBtc = await rateFor(fiatCurrency);
    if (!fiatPerBtc) throw new InvoiceError("RATE_UNAVAILABLE", 503);
    amountSats = fiatToSats(input.amountFiat!, fiatPerBtc);
    satsPerUnit = String(fiatPerBtc);
    if (amountSats < 1) throw new InvoiceError("AMOUNT_TOO_SMALL");
  }

  // ---- one-time address derivation ----
  let address = "";
  let ephemeralPub: string | null = null;
  let derivationIndex: number | null = null;
  if (merchant.walletMode === "selfcustody" && merchant.paymentCode) {
    const d = deriveInvoiceAddress(merchant.paymentCode);
    address = d.address;
    ephemeralPub = d.ephemeralPub ?? null;
  } else if (merchant.accountXpub) {
    // watch-only: deterministic index = count of prior invoices. Concurrent
    // creations could collide on the same index (unique stealthAddress) —
    // probe forward until a free index is found instead of erroring.
    let idx = await db.invoice.count({ where: { merchantId: merchant.id } });
    for (let attempt = 0; attempt < 10; attempt++) {
      const d = deriveWatchOnlyAddress(merchant.accountXpub, idx);
      const clash = await db.invoice.findFirst({
        where: { stealthAddress: d.address },
        select: { id: true },
      });
      if (!clash) {
        derivationIndex = idx;
        address = d.address;
        break;
      }
      idx++;
    }
    if (derivationIndex === null) throw new InvoiceError("DERIVATION_BUSY", 503);
  } else {
    throw new InvoiceError("WALLET_NOT_CONFIGURED", 409);
  }
  if (!address) throw new InvoiceError("DERIVATION_BUSY", 503);

  // ---- persist ----
  const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? merchant.invoiceExpiryMinutes) * 60_000);
  const buyerLang = input.buyerLang ?? (req ? detectLang(req.headers.get("accept-language")) : "en");

  let invoice;
  try {
    invoice = await db.invoice.create({
      data: {
        merchantId: merchant.id,
        amountSats: BigInt(amountSats),
        fiatCurrency,
        fiatAmountCents,
        satsPerUnit,
        derivationMode: derivationIndex === null ? "stealth" : "watchonly",
        stealthAddress: address,
        ephemeralPub,
        paymentCodeSnapshot: merchant.paymentCode,
        derivationIndex,
        orderId: input.orderId,
        description: input.description,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        buyerLang,
        idempotencyKey: idemKey ?? null,
        status: "waiting",
        confirmationsRequired: Math.max(merchant.confirmationsRequired, 1),
        expiresAt,
      },
    });
  } catch (e) {
    // lost a concurrent same-key race → serve the winner's invoice
    if (
      idemKey &&
      typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
    ) {
      const winner = await db.invoice.findFirst({
        where: { merchantId: merchant.id, idempotencyKey: idemKey },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (winner) return { id: winner.id, replayed: true };
    }
    throw e;
  }

  // ---- Lightning rail (optional, merchant's own phoenixd) ----
  // The on-chain stealth address is ALWAYS there. If a phoenixd node is
  // connected we also mint a bolt11 from it, tagged with our invoice id as
  // externalId. A node failure must NEVER block invoice creation — degrade
  // gracefully to on-chain-only.
  // Privacy posture: in "maximum" mode Lightning is deliberately OFF —
  // every invoice rides the on-chain stealth rail only.
  if (
    getSettings().privacyMode !== "maximum" &&
    merchant.lightningUrl &&
    merchant.lightningStatus === "ok"
  ) {
    const password = lightningPasswordOf(merchant);
    if (password) {
      try {
        const ln = await phoenixdCreateInvoice(merchant.lightningUrl, password, {
          amountMsat: amountSats * 1_000,
          description: input.description
            ? `${merchant.name}: ${input.description}`
            : `Payment to ${merchant.name}${input.orderId ? ` (order ${input.orderId})` : ""}`,
          externalId: invoice.id,
        });
        if (ln.paymentHash) {
          await db.invoice.update({
            where: { id: invoice.id },
            data: { lightningPaymentRequest: ln.bolt11, lightningPaymentHash: ln.paymentHash },
          });
        }
      } catch (err) {
        console.error(
          "[lightning] createinvoice failed, degrading to on-chain",
          err instanceof PhoenixdError ? err.message : err
        );
      }
    }
  }

  return { id: invoice.id, replayed: false };
}

export function checkoutUrlFor(req: Request, invoiceId: string): string {
  // LP_BASE_URL wins when set — deterministic URLs behind proxies/Tor, and
  // the checkoutUrl must keep working after the creating request is gone.
  const base = env.BASE_URL;
  if (base) return `${base}/pay/${invoiceId}`;
  const origin = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (origin.includes("localhost") ? "http" : "https");
  return `${proto}://${origin}/pay/${invoiceId}`;
}
