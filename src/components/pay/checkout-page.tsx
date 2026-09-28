"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy, Check, Clock, ExternalLink, Loader2, ShieldCheck, FlaskConical, Ban, CircleCheck,
  Undo2, HandCoins, Info, Zap, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { detectLang, t as tr, type Lang } from "@/lib/i18n";
import { LanguageDropdown } from "@/components/language-switcher";
import { formatSats, formatFiat } from "@/lib/bitcoin";
import { toast } from "@/hooks/use-toast";

interface PublicInvoice {
  id: string;
  status: string;
  amountSats: string;
  receivedSats: string;
  fiatCurrency: string | null;
  fiatAmountCents: number | null;
  description: string | null;
  orderId: string | null;
  address: string;
  paymentUri: string;
  lightningPaymentRequest: string | null;
  lightningAvailable: boolean;
  paidVia: string | null;
  txid: string | null;
  confirmations: number;
  confirmationsRequired: number;
  expiresAt: string;
  buyerLang: Lang;
  refundStatus: string;
  refundTxid: string | null;
  refundDeclineReason: string | null;
  refundsEnabled: boolean;
  refundWindowDays: number;
  /** derived server-side from the operator's ESPLORA_API — self-hosted explorers stay self-hosted */
  explorerTxBase: string | null;
  merchant: { name: string; brandColor: string; logoUrl: string | null };
}

const EXPLORER_FALLBACK = "https://mempool.space";

const STATUS_FLOW = ["waiting", "detected", "confirmed", "settled"] as const;

export function CheckoutPage({ invoiceId }: { invoiceId: string }) {
  const [inv, setInv] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAddress, setRefundAddress] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const [rail, setRail] = useState<"onchain" | "lightning">("lightning");
  // refs guard the poll loop: no duplicate in-flight requests, no stale
  // out-of-order overwrites, and polling stops once a terminal status lands.
  const invRef = useRef<PublicInvoice | null>(null);
  const inFlightRef = useRef(false);
  const terminalRef = useRef(false);

  // language priority: ?lang= > localStorage > invoice.buyerLang > en
  useEffect(() => {
    // Storage/URL reads run in a microtask — no synchronous setState in the effect body.
    queueMicrotask(() => {
      const q = new URLSearchParams(window.location.search).get("lang");
      if (q && detectLang(q)) { setLang(detectLang(q)); return; }
      const stored = localStorage.getItem("librepay-lang");
      if (stored && detectLang(stored)) { setLang(detectLang(stored)); return; }
      if (inv?.buyerLang) setLang(inv.buyerLang);
    });
  }, [inv?.buyerLang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const load = useCallback(async () => {
    if (inFlightRef.current || terminalRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/public/invoice/${invoiceId}`);
      if (!res.ok) {
        // 404 (before anything loaded) → error screen; transient failures
        // while a good invoice is already on screen → keep showing it.
        if (!invRef.current) setError(res.status === 404 ? "not_found" : "error");
        return;
      }
      const data = await res.json();
      setError(null); // clear sticky error state on any successful poll
      invRef.current = data.invoice as PublicInvoice;
      if (["settled", "expired", "underpaid"].includes(data.invoice.status)) {
        terminalRef.current = true; // stop polling after a terminal status
      }
      setInv(data.invoice);
    } catch {
      if (!invRef.current) setError("network");
    } finally {
      inFlightRef.current = false;
    }
  }, [invoiceId]);

  useEffect(() => {
    queueMicrotask(() => void load());
    const iv = setInterval(() => void load(), 7_000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const t = useCallback((k: string, vars?: Record<string, string | number>) => tr(lang, k, vars), [lang]);

  // default to Lightning tab when both rails exist (fastest UX); buyer can switch
  useEffect(() => {
    queueMicrotask(() => {
      if (inv && !inv.lightningAvailable && rail === "lightning") setRail("onchain");
    });
  }, [inv?.lightningAvailable, rail, inv]);

  const remaining = useMemo(() => {
    if (!inv) return 0;
    return Math.max(0, new Date(inv.expiresAt).getTime() - now);
  }, [inv, now]);

  const copy = async (v: string, key: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast({ title: t("common.error"), description: key, variant: "destructive" });
    }
  };

  const simulate = async (settle = false, method?: "lightning") => {
    try {
      const res = await fetch("/api/dev/simulate-payment", {
        method: settle ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId, method }),
      });
      if (res.ok) void load();
    } catch { /* disabled in production */ }
  };

  const submitRefundRequest = async () => {
    setRefundBusy(true);
    try {
      const res = await fetch(`/api/public/invoice/${invoiceId}/refund-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refundAddress: refundAddress.trim() || undefined,
          reason: refundReason.trim() || undefined,
        }),
      });
      if (res.ok) {
        setShowRefundForm(false);
        setRefundAddress("");
        setRefundReason("");
        toast({ title: t("refund.requested"), description: t("refund.requested.sub") });
        void load();
      } else {
        const data = await res.json().catch(() => ({}));
        const msgs: Record<string, string> = {
          refund_window_closed: t("refund.window.closed"),
          refunds_disabled: t("refund.window.closed"),
          refund_already_exists: t("refund.requested"),
          invalid_address: t("refund.request.address"),
          invoice_not_paid: t("common.error"),
          rate_limited: t("common.error"),
        };
        toast({
          title: t("common.error"),
          description: msgs[data.error as string] ?? data.error ?? "error",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    } finally {
      setRefundBusy(false);
    }
  };

  if (error) {
    return (
      <CenteredBox>
        <div className="py-10 text-center">
          <Ban className="mx-auto mb-4 h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-bold">{error === "not_found" ? t("pay.notfound") : t("common.error")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error === "not_found" ? t("pay.notfound.hint") : t("pay.error.hint")}
          </p>
        </div>
      </CenteredBox>
    );
  }

  if (!inv) {
    return (
      <CenteredBox>
        <div className="space-y-4 p-6">
          <Skeleton className="mx-auto h-8 w-48" />
          <Skeleton className="mx-auto h-44 w-44" />
          <Skeleton className="mx-auto h-6 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CenteredBox>
    );
  }

  const brand = inv.merchant.brandColor || "#F7931A";
  // expired when the server already marked it expired (cron), OR the clock ran
  // out while still waiting/detected (cron lag). Previously a DB-expired
  // invoice fell through to the "waiting + 00:00" default branch — fixed.
  const expired =
    inv.status === "expired" ||
    (remaining <= 0 && ["waiting", "detected"].includes(inv.status));
  const terminal = ["settled", "expired", "underpaid"].includes(inv.status);
  const stepIdx = STATUS_FLOW.indexOf(inv.status as (typeof STATUS_FLOW)[number]);

  return (
    <CenteredBox>
      <div className="fixed end-3 top-3 z-50">
        <LanguageDropdown lang={lang} onLangChange={setLang} />
      </div>
      <main className="p-6 sm:p-8" style={{ borderTop: `4px solid ${brand}` }}>
        {/* merchant header */}
        <div className="mb-6 text-center">
          {inv.merchant.logoUrl ? (
            <img
              src={inv.merchant.logoUrl}
              alt={inv.merchant.name}
              className="mx-auto mb-3 h-16 w-16 rounded-xl object-contain p-1 ring-1 ring-border"
            />
          ) : (
            <div className="mb-3 inline-grid h-11 w-11 place-items-center rounded-xl text-lg font-extrabold" style={{ background: `${brand}22`, color: brand }} aria-hidden="true">
              {inv.merchant.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <h1 className="text-lg font-bold"><bdi>{inv.merchant.name}</bdi></h1>
          {(inv.description || inv.orderId) && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {inv.description && <bdi>{inv.description}</bdi>}
              {inv.description && inv.orderId && <span aria-hidden="true"> · </span>}
              {inv.orderId && <bdi dir="ltr">#{inv.orderId}</bdi>}
            </p>
          )}
        </div>

        {/* progress steps */}
        {!expired && (
          <ol className="mb-6 flex items-center gap-1.5" aria-label="Payment progress">
            {STATUS_FLOW.map((s, i) => (
              <li key={s} className="flex-1" aria-current={inv.status === s ? "step" : undefined}>
                <div
                  className={`h-1.5 rounded-full transition-colors ${
                    i <= stepIdx ? "" : "bg-muted"
                  }`}
                  style={i <= stepIdx ? { background: brand } : undefined}
                />
                <span className={`mt-1 block text-center text-[10px] ${i <= stepIdx ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  {t(`st.${s}`).split(" ")[0]}
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* amount */}
        <div className="mb-6 text-center">
          <div className="text-sm text-muted-foreground">{t("pay.to")}</div>
          <div className="mt-1 font-mono text-4xl font-extrabold tracking-tight" style={{ color: brand }}>
            {formatSats(inv.amountSats)} <span className="text-2xl">sats</span>
          </div>
          {inv.fiatCurrency && inv.fiatAmountCents ? (
            <div className="mt-1 text-sm text-muted-foreground">
              {t("pay.fiatest")} {formatFiat(inv.fiatAmountCents, inv.fiatCurrency)}
            </div>
          ) : null}
        </div>

        {/* status content */}
        {expired ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
            <Ban className="mx-auto mb-2 h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="font-semibold">{t("pay.expired")}</p>
          </div>
        ) : inv.status === "underpaid" ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-center">
            <p className="font-semibold text-amber-300">{t("pay.underpaid")}</p>
          </div>
        ) : ["confirmed", "settled"].includes(inv.status) ? (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: `${brand}66`, background: `${brand}14` }}>
            <CircleCheck className="mx-auto mb-2 h-10 w-10" style={{ color: brand }} aria-hidden="true" />
            <p className="text-lg font-bold">{inv.status === "settled" ? t("pay.settled") : t("pay.confirmed")}</p>
            {inv.status === "settled" && inv.paidVia && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium" style={{ color: brand }}>
                {inv.paidVia === "lightning" ? <Zap className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                {inv.paidVia === "lightning" ? t("st.paidvia.lightning") : t("st.paidvia.onchain")}
              </p>
            )}
            {inv.paidVia === "lightning" && inv.status === "settled" && (
              <p className="mt-1 text-xs text-muted-foreground">{t("pay.instantsub")}</p>
            )}
            {inv.txid && (
              <a
                href={`${inv.explorerTxBase ?? EXPLORER_FALLBACK}/tx/${inv.txid}`}
                target="_blank" rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("pay.opentx")} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <>
            {/* rail tabs — [On-chain] / [⚡ Lightning] */}
            {inv.lightningAvailable ? (
              <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1" role="tablist" aria-label={t("pay.method")}>
                {(["lightning", "onchain"] as const).map((r) => (
                  <button
                    key={r}
                    role="tab"
                    aria-selected={rail === r}
                    onClick={() => setRail(r)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                      rail === r ? "text-white" : "text-muted-foreground hover:text-foreground"
                    }`}
                    style={rail === r ? { background: brand } : undefined}
                  >
                    {r === "lightning" ? (
                      <>
                        <Zap className="h-4 w-4" aria-hidden="true" /> Lightning
                      </>
                    ) : (
                      <>
                        <Link2 className="h-4 w-4" aria-hidden="true" /> {t("lightning.tab.onchain")}
                      </>
                    )}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mb-3 text-center text-xs text-muted-foreground">
              {rail === "lightning" && inv.lightningAvailable ? t("lightning.tab.hint.lightning") : t("lightning.tab.hint.onchain")}
            </p>

            {/* QR */}
            <div className="mx-auto mb-4 w-fit rounded-2xl bg-white p-3">
              <QRCodeSVG
                value={rail === "lightning" && inv.lightningAvailable ? `lightning:${inv.lightningPaymentRequest}` : inv.paymentUri}
                size={196}
                level="M"
                aria-label={rail === "lightning" ? "Lightning payment QR code" : "Bitcoin on-chain payment QR code"}
              />
            </div>

            {rail === "lightning" && inv.lightningAvailable ? (
              // bolt11 copy row
              <button
                onClick={() => void copy(inv.lightningPaymentRequest!, "bolt11")}
                className="mb-4 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 p-3 text-start transition-colors hover:border-primary/40"
                aria-label="Copy Lightning invoice"
              >
                <span className="scrollbar-thin overflow-x-auto whitespace-nowrap font-mono text-xs">
                  {inv.lightningPaymentRequest!.slice(0, 42)}…
                </span>
                {copied === "bolt11" ? <Check className="h-4 w-4 shrink-0 text-emerald-400" /> : <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
            ) : (
              // address
              <div className="mb-4">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("pay.address")}</div>
                <button
                  onClick={() => void copy(inv.address, "addr")}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 p-3 text-start transition-colors hover:border-primary/40"
                >
                  <span className="scrollbar-thin overflow-x-auto whitespace-nowrap font-mono text-xs">
                    {inv.address}
                  </span>
                  {copied === "addr" ? <Check className="h-4 w-4 shrink-0 text-emerald-400" /> : <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
              </div>
            )}

            {/* timer */}
            <div className="mb-4 flex items-center justify-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">{t("pay.timer")}:</span>
              <span className="font-mono font-semibold" suppressHydrationWarning>
                {String(Math.floor(remaining / 60000)).padStart(2, "0")}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}
              </span>
            </div>

            {/* live status */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: brand }} aria-hidden="true" />
              {inv.status === "detected"
                ? `${t("pay.detected")} (${t("pay.confcount", { n: inv.confirmations, m: inv.confirmationsRequired })})`
                : t("pay.waiting")}
            </div>
            {inv.status === "detected" && inv.txid && (
              <div className="mt-2 text-center">
                <a href={`${inv.explorerTxBase ?? EXPLORER_FALLBACK}/tx/${inv.txid}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  {t("pay.opentx")} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* dev simulate */}
            <div className="mt-6 flex justify-center gap-2 opacity-40 transition-opacity hover:opacity-100">
              <Button variant="ghost" size="sm" onClick={() => void simulate()} title="Dev: simulate mempool + confirmation">
                <FlaskConical className="me-1 h-3.5 w-3.5" /> simulate
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void simulate(true)} title="Dev: simulate settlement">
                settle
              </Button>
              {inv.lightningAvailable && (
                <Button variant="ghost" size="sm" onClick={() => void simulate(false, "lightning")} title="Dev: simulate instant Lightning payment">
                  <Zap className="me-1 h-3.5 w-3.5" /> simulate LN
                </Button>
              )}
            </div>
          </>
        )}

        {/* ---- refunds: manual, non-custodial — sent by the merchant ---- */}
        <RefundSection
          inv={inv}
          t={t}
          brand={brand}
          showForm={showRefundForm}
          setShowForm={setShowRefundForm}
          refundAddress={refundAddress}
          setRefundAddress={setRefundAddress}
          refundReason={refundReason}
          setRefundReason={setRefundReason}
          busy={refundBusy}
          onSubmit={() => void submitRefundRequest()}
          onCopy={copy}
          copied={copied}
        />

        <footer className="mt-8 flex items-center justify-center gap-1.5 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {t("pay.powered")} <strong>LibrePay</strong> — {t("pay.footer.sub")}
        </footer>
      </main>
    </CenteredBox>
  );
}

function CenteredBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="libre-grid-bg flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl libre-glow">
        {children}
      </div>
    </div>
  );
}

type TR = (k: string, vars?: Record<string, string | number>) => string;

interface RefundSectionProps {
  inv: PublicInvoice;
  t: TR;
  brand: string;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  refundAddress: string;
  setRefundAddress: (v: string) => void;
  refundReason: string;
  setRefundReason: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
  onCopy: (v: string, key: string) => Promise<void>;
  copied: string | null;
}

/**
 * Manual, non-custodial refund panel. LibrePay CANNOT send refunds — the
 * merchant does, from their own wallet. We say it proudly: if we could send
 * your refund programmatically, we would also be able to take the money.
 */
function RefundSection(props: RefundSectionProps) {
  const { inv, t, brand, showForm, setShowForm, refundAddress, setRefundAddress, refundReason, setRefundReason, busy, onSubmit, onCopy, copied } = props;

  const paidStates = ["confirmed", "settled", "underpaid"];
  if (!paidStates.includes(inv.status)) return null;

  if (inv.refundStatus === "refunded") {
    return (
      <section className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4" aria-live="polite">
        <p className="flex items-center gap-2 font-semibold text-emerald-400">
          <HandCoins className="h-4 w-4" aria-hidden="true" /> {t("refund.refunded")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("refund.refunded.sub")}</p>
        {inv.refundTxid && (
          <button
            onClick={() => void onCopy(inv.refundTxid!, "rtxid")}
            className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-start hover:border-primary/40"
          >
            <span className="overflow-x-auto whitespace-nowrap font-mono text-[11px]">{inv.refundTxid}</span>
            {copied === "rtxid" ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          </button>
        )}
        {inv.refundTxid && (
          <a
            href={`${inv.explorerTxBase ?? EXPLORER_FALLBACK}/tx/${inv.refundTxid}`}
            target="_blank" rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("pay.opentx")} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {t("refund.trust")}
        </p>
      </section>
    );
  }

  if (inv.refundStatus === "declined") {
    return (
      <section className="mt-6 rounded-xl border border-border bg-muted/20 p-4" aria-live="polite">
        <p className="flex items-center gap-2 font-semibold">
          <Ban className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {t("refund.declined")}
        </p>
        {inv.refundDeclineReason && <p className="mt-1 text-xs text-muted-foreground">{inv.refundDeclineReason}</p>}
      </section>
    );
  }

  if (inv.refundStatus === "requested" || inv.refundStatus === "refunding") {
    return (
      <section className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" aria-live="polite">
        <p className="flex items-center gap-2 font-semibold text-amber-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {inv.refundStatus === "refunding" ? t("refund.refunding") : t("refund.requested")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("refund.requested.sub")}</p>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {t("refund.trust")}
        </p>
      </section>
    );
  }

  // refundStatus === "none" — show request button (if enabled)
  if (!inv.refundsEnabled) return null;

  return (
    <section className="mt-6 border-t border-border/60 pt-4">
      {!showForm ? (
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setShowForm(true)}>
          <Undo2 className="me-2 h-4 w-4" aria-hidden="true" />
          {t("refund.request.btn")}
        </Button>
      ) : (
        <div className="space-y-3" style={{ borderColor: brand }}>
          <div>
            <p className="text-sm font-semibold">{t("refund.request.title")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("refund.request.sub")}</p>
          </div>
          <div>
            <label htmlFor="refund-address" className="mb-1 block text-xs font-medium">
              {t("refund.request.address")}
            </label>
            <Input
              id="refund-address"
              value={refundAddress}
              onChange={(e) => setRefundAddress(e.target.value)}
              placeholder="bc1q…"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("refund.request.address.hint")}</p>
          </div>
          <div>
            <label htmlFor="refund-reason" className="mb-1 block text-xs font-medium">
              {t("refund.request.reason")}
            </label>
            <Textarea id="refund-reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={2} className="text-xs" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={onSubmit} className="flex-1">
              {busy ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="me-1 h-3.5 w-3.5" />}
              {t("refund.request.submit")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("refund.trust")}</p>
        </div>
      )}
    </section>
  );
}
