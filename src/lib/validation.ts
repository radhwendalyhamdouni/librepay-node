/**
 * Zod validation schemas — every mutating endpoint validates its input here.
 */

import { z } from "zod";

export const emailSchema = z.email().max(254).transform((s) => s.trim().toLowerCase());

/** All supported buyer/checkout languages (single source of truth). */
export const LANG_CODES = ["en", "ar", "fr", "es", "pt", "fil"] as const;
export const langEnum = z.enum(LANG_CODES);

export const createInvoiceSchema = z
  .object({
    amountSats: z.number().int().min(1).max(2_100_000_000_000).optional(),
    amountFiat: z.number().min(0.01).max(1_000_000_000).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    orderId: z.string().max(64).optional(),
    description: z.string().max(140).optional(),
    expiresInMinutes: z.number().int().min(5).max(120).optional(),
    buyerLang: langEnum.optional(),
    // Per-value caps: a record of multi-MB strings would bloat the DB and the
    // serialized webhook payloads. Keys ≤32 chars, values ≤256 chars.
    metadata: z
      .record(
        z.string().min(1).max(32),
        z.union([z.string().max(256), z.number(), z.boolean(), z.null()])
      )
      .optional(),
  })
  .refine((d) => d.amountSats !== undefined || (d.amountFiat !== undefined && d.currency !== undefined), {
    message: "Provide amountSats, or amountFiat + currency",
  });

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const webhookEndpointSchema = z.object({
  url: z.url().refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), {
    message: "Webhook URL must be HTTPS (localhost allowed for development)",
  }),
  events: z
    .array(
      z.enum([
        "invoice.detected", "invoice.confirmed", "invoice.settled", "invoice.expired", "invoice.underpaid",
        "refund.requested", "refund.completed", "refund.declined",
      ])
    )
    .min(1)
    .optional(),
});

/**
 * Merchant logo source: https URL, or an inline PNG/JPEG/WebP data URL
 * (dashboard upload resizes to ≤256px and re-encodes client-side, so the
 * stored payload stays well under this cap). Explicitly NOT svg+xml —
 * script-bearing SVG has no business in a stored brand field. `null` removes.
 */
export const merchantLogoSchema = z
  .string()
  .max(160_000)
  .refine(
    (v) =>
      /^https:\/\/[^\s]+$/i.test(v) ||
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(v),
    { message: "logo must be https URL or data:image/png|jpeg|webp;base64" },
  );

/**
 * Sanitize a user-entered display name (store name, labels, …).
 *
 * Strips invisible / accidental characters that would otherwise be stored
 * forever and render oddly in headings:
 * - Arabic tashkeel (harakat U+064B–U+0655, superscript alef U+0670): a stray
 *   damma typed before a Latin word once produced the store name "ُECPMIND".
 *   Store names never carry meaningful vocalization — drop it.
 * - Bidi/ directional controls (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069)
 *   and zero-width characters (U+200B–U+200D, U+FEFF): invisible and only
 *   ever cause rendering surprises.
 * Then trims and collapses runs of whitespace.
 */
export function sanitizeDisplayName(input: string): string {
  return input
    .replace(/[\u064B-\u0655\u0670\u200B-\u200D\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const merchantSettingsSchema = z.object({
  // Sanitize BEFORE length checks: a name of only diacritics becomes "" and is
  // then rejected by the piped min(1), while diacritics inside a longer name
  // free up space so the stored value respects max(60).
  name: z
    .string()
    .max(80)
    .transform(sanitizeDisplayName)
    .pipe(z.string().min(1).max(60))
    .optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: merchantLogoSchema.nullable().optional(),
  defaultLang: langEnum.optional(),
  confirmationsRequired: z.number().int().min(1).max(6).optional(),
  invoiceExpiryMinutes: z.number().int().min(5).max(120).optional(),
  refundsEnabled: z.boolean().optional(),
  refundWindowDays: z.number().int().min(0).max(365).optional(),
});

// ---------------------------------------------------------------------------
// Lightning (merchant's OWN phoenixd node)
// ---------------------------------------------------------------------------

/**
 * Phoenixd connection input. Allow http/https here; the SSRF guard enforces
 * the real policy (https in production, localhost/127.0.0.1 allowed in dev).
 */
export const lightningConnectSchema = z.object({
  url: z
    .string()
    .min(10)
    .max(200)
    .regex(/^https?:\/\/[a-zA-Z0-9.:-]+$/, "URL must be http(s)://host[:port]"),
  password: z.string().min(6).max(200),
});

export const watchOnlySchema = z.object({
  xpub: z.string().min(100).max(120).regex(/^(xpub|zpub)[1-9A-HJ-NP-Za-km-z]+$/),
});

export const simulatePaymentSchema = z.object({
  invoiceId: z.string().min(10).max(64),
  /** simulate underpayment for testing */
  underpay: z.boolean().optional(),
  /** simulate a Lightning (instant) payment instead of on-chain */
  method: z.enum(["onchain", "lightning"]).optional(),
});

export const subscriptionSchema = z.object({
  plan: z.enum(["starter", "pro", "business"]),
  interval: z.enum(["monthly", "semiannual", "yearly"]),
});

export const IPUBLISHED_WALLET_MODES = ["selfcustody", "watchonly"] as const;

export const publishWalletSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("selfcustody"),
    paymentCode: z.string().min(90).max(120),
    accountZpub: z.string().min(100).max(120).optional(),
  }),
  z.object({
    mode: z.literal("watchonly"),
    xpub: z.string().min(100).max(120),
  }),
]);

// ---------------------------------------------------------------------------
// Refunds — manual, non-custodial. The buyer requests; the MERCHANT sends
// from their own wallet and pastes the txid. LibrePay cannot move funds.
// ---------------------------------------------------------------------------

/** Buyer side (public checkout page) — address optional, reason optional. */
export const refundRequestSchema = z.object({
  refundAddress: z.string().max(95).optional(),
  reason: z.string().max(500).optional(),
});

/** Merchant side (dashboard) — approve / complete (with txid) / decline. */
export const refundActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), sats: z.number().int().min(1).max(2_100_000_000_000).optional() }),
  z.object({ action: z.literal("complete"), txid: z.string().regex(/^[0-9a-fA-F]{64}$/) }),
  z.object({ action: z.literal("decline"), reason: z.string().max(300).optional() }),
]);

/** All webhook events LibrePay can emit (single source of truth). */
export const ALL_WEBHOOK_EVENTS = [
  "invoice.detected", "invoice.confirmed", "invoice.settled", "invoice.expired", "invoice.underpaid",
  "refund.requested", "refund.completed", "refund.declined",
] as const;

export const DEFAULT_WEBHOOK_EVENTS = ALL_WEBHOOK_EVENTS.join(",");

// ---------------------------------------------------------------------------
// Support tickets — merchant ↔ admin conversation inside the platform.
// ---------------------------------------------------------------------------

export const TICKET_CATEGORIES = ["billing", "technical", "general", "feature"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high"] as const;
export const TICKET_STATUSES = ["open", "answered", "pending", "resolved"] as const;

export const ticketCreateSchema = z.object({
  subject: z.string().min(4).max(120).transform((s) => s.trim()),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  message: z.string().min(10).max(4000).transform((s) => s.trim()),
});

export const ticketReplySchema = z.object({
  body: z.string().min(2).max(4000).transform((s) => s.trim()),
});

export const ticketActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve") }),
  z.object({ action: z.literal("reopen") }),
]);

// ---------------------------------------------------------------------------
// Announcements — admin broadcasts (news / promo / discount) to merchants.
// actionUrl is RELATIVE-ONLY: it can never become an open-redirect surface.
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_KINDS = ["news", "promo", "discount"] as const;

const relativeUrl = (u: string) => u.startsWith("/") && !u.startsWith("//") && !u.includes("\\");

export const announcementSchema = z.object({
  title: z.string().min(3).max(120).transform((s) => s.trim()),
  body: z.string().min(10).max(2000).transform((s) => s.trim()),
  kind: z.enum(ANNOUNCEMENT_KINDS),
  actionUrl: z
    .string()
    .max(200)
    .optional()
    .transform((s) => (s === undefined || s.trim() === "" ? undefined : s.trim()))
    .refine((u) => u === undefined || relativeUrl(u), {
      message: "actionUrl must be a relative path starting with /",
    }),
});

// ---------------------------------------------------------------------------
// Plan pricing — admin-editable monthly USD price + visibility, per plan.
// Free is pinned to $0 (the free tier is the product's promise); paid plans
// are capped at $10,000/mo (a typo guard, not a business rule).
// ---------------------------------------------------------------------------

export const planUpdateSchema = z.object({
  plans: z
    .array(
      z.object({
        id: z.enum(["free", "starter", "pro", "business"]),
        monthlyUsdCents: z.number().int().min(0).max(1_000_000),
        active: z.boolean(),
      })
    )
    .min(1)
    .max(4),
});

// ---------- public news / blog (admin-authored) ----------
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const newsPostSchema = z.object({
  title: z.string().min(3).max(140).transform((s) => s.trim()),
  slug: z
    .string()
    .min(1)
    .max(120)
    .transform((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .refine((s) => SLUG_RE.test(s), { message: "slug must be [a-z0-9-]" }),
  excerpt: z.string().max(300).optional().transform((s) => (s === undefined || s.trim() === "" ? undefined : s.trim())),
  body: z.string().min(10).max(50_000).transform((s) => s.trim()),
  image: z
    .string()
    .max(600)
    .optional()
    .transform((s) => (s === undefined || s.trim() === "" ? undefined : s.trim()))
    .refine((u) => u === undefined || /^https?:\/\//i.test(u) || u.startsWith("/"), {
      message: "image must be an http(s) or site-relative URL",
    }),
  published: z.boolean().default(false),
});

export const newsPostUpdateSchema = newsPostSchema
  .partial()
  // CRITICAL: .partial() alone keeps the .default(false) on `published`, which
  // would silently UNPUBLISH a post on every body-only PATCH. Override with a
  // plain optional boolean so a missing key means "don't touch".
  .extend({ published: z.boolean().optional() });
