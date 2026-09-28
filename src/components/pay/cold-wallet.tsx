"use client";

/**
 * Cold Wallet generator — 100% client-side. The node ships it as a static
 * page so the operator can generate a receiving wallet WITHOUT trusting
 * anything: load the page, disconnect from the internet, generate.
 *
 * No fetch(), no analytics, no telemetry — the browser tab IS the tool.
 * Keys derive locally via audited @scure libraries (BIP39 → BIP32 →
 * payment code / zpub). The mnemonic never leaves this tab except to
 * your eyes.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, TriangleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  newMnemonic,
  seedFromMnemonic,
  deriveWalletKeys,
  isValidMnemonic,
  normalizeMnemonic,
  toWIF,
  pubkeyToBech32Address,
} from "@/lib/server/keys";
import { HDKey } from "@scure/bip32";

type Lang = "en" | "ar";

const T: Record<Lang, Record<string, string>> = {
  en: {
    title: "Cold Wallet Generator",
    sub: "Runs entirely in this browser tab. Nothing is sent, stored, or logged — anywhere.",
    offlineTitle: "Best practice: go offline first",
    offlineBody:
      "Load this page, disconnect your device from the internet (Wi-Fi off, cable pulled), then generate. The page keeps working — that is the point. For air-gapped use, save the page (Ctrl+S) and open the saved file any time.",
    modeGenerate: "Generate new wallet",
    modeRestore: "Restore from words",
    words: "Words",
    generate: "Generate",
    restoring: "Paste your 12 or 24 recovery words",
    restorePlaceholder: "twenty four words separated by spaces…",
    restore: "Restore",
    badMnemonic: "Invalid recovery phrase — check spelling and word order.",
    mnemonicTitle: "Recovery phrase — write it down NOW",
    mnemonicWarn:
      "Anyone who sees these words owns every coin behind them. There is no reset, no support, no refund. Write them on paper. Never type them into a website, chat, or photo.",
    reveal: "reveal",
    hide: "hide",
    paycodeTitle: "Payment code (BIP47 stealth)",
    paycodeNote:
      "Paste this into Setup → Wallet. Every invoice then derives a unique stealth address; the chain never links your payments together.",
    zpubTitle: "zpub — watch-only (BIP84)",
    zpubNote:
      "Alternative to the payment code: standard BIP84 watch-only key for Sparrow, Electrum, BlueWallet or a hardware wallet. Funds land in normal bech32 addresses.",
    firstAddrTitle: "First BIP84 address (m/84'/0'/0'/0/0)",
    firstAddrNote: "Sanity check — import the zpub in your wallet and its first address must match this one.",
    wifTitle: "Private keys (recovery only)",
    wifScan: "Scan key WIF",
    wifSpend: "Spend key WIF",
    wifNote:
      "Advanced: per-invoice stealth spending keys are exported from your node's Wallet tab (computed in your browser via ECDH). Keep these two WIFs with the paper backup only if you understand stealth derivation.",
    nextTitle: "Next step",
    nextBody: "Open the setup wizard and paste the payment code or zpub. The node watches the chain for you — it can never spend.",
    openSetup: "Open Setup Wizard",
    again: "Start over (wipe from memory)",
    copied: "Copied",
    notStored: "Nothing here is stored. Leaving or reloading this page erases the keys from memory.",
    generatedOffline: "Generated in this tab",
  },
  ar: {
    title: "مولّد المحفظة الباردة",
    sub: "يعمل كلياً داخل تبويب المتصفح هذا. لا يُرسل ولا يُخزَّن ولا يُسجَّل أي شيء — في أي مكان.",
    offlineTitle: "القاعدة الذهبية: اقطع الإنترنت أولاً",
    offlineBody:
      "افتح هذه الصفحة، ثم اقطع اتصال جهازك بالإنترنت (أوقف Wi-Fi أو افصل الكابل)، ثم ولّد المحفظة. الصفحة تظل تعمل — وهذا هو الغرض. للاستخدام المعزول تماماً، احفظ الصفحة (Ctrl+S) وافتح الملف المحفوظ في أي وقت.",
    modeGenerate: "توليد محفظة جديدة",
    modeRestore: "استعادة من الكلمات",
    words: "كلمة",
    generate: "توليد",
    restoring: "الصق عبارة الاستعادة (12 أو 24 كلمة)",
    restorePlaceholder: "أربع وعشرون كلمة مفصولة بمسافات…",
    restore: "استعادة",
    badMnemonic: "عبارة الاستعادة غير صالحة — تحقق من الإملاء وترتيب الكلمات.",
    mnemonicTitle: "عبارة الاستعادة — دوّنها الآن",
    mnemonicWarn:
      "أي شخص يرى هذه الكلمات يملك كل العملات خلفها. لا يوجد استعادة ولا دعم ولا استرداد. اكتبها على ورق. لا تكتبها أبداً في موقع أو محادثة أو صورة.",
    reveal: "إظهار",
    hide: "إخفاء",
    paycodeTitle: "رمز الدفع (BIP47 stealth)",
    paycodeNote:
      "الصقه في الإعداد → المحفظة. بعد ذلك تُشتق لكل فاتورة عنوان صامت فريد، ولن تربط سلسلة الكتل مدفوعاتك ببعضها أبداً.",
    zpubTitle: "zpub — مشاهدة فقط (BIP84)",
    zpubNote:
      "بديل عن رمز الدفع: مفتاح BIP84 قياسي للمشاهدة فقط يعمل مع Sparrow وElectrum وBlueWallet والمحافظ العتادية. تصل الأموال إلى عناوين bech32 عادية.",
    firstAddrTitle: "أول عنوان BIP84 (m/84'/0'/0'/0/0)",
    firstAddrNote: "فحص صحي — استورد zpub في محفظتك ويجب أن يطابق عنوانها الأول هذا العنوان.",
    wifTitle: "المفاتيح الخاصة (للاستعادة فقط)",
    wifScan: "مفتاح المسح WIF",
    wifSpend: "مفتاح الإنفاق WIF",
    wifNote:
      "متقدم: تُصدَّر مفاتيح الإنفاق الصامت لكل فاتورة من تبويب المحفظة في عقدتك (تُحسب في متصفحك عبر ECDH). احتفظ بمفتاحي WIF هذين مع النسخة الورقية فقط إذا كنت تفهم اشتقاق العناوين الصامتة.",
    nextTitle: "الخطوة التالية",
    nextBody: "افتح معالج الإعداد والصق رمز الدفع أو zpub. العقدة تراقب السلسلة نيابة عنك — ولا تستطيع الإنفاق أبداً.",
    openSetup: "فتح معالج الإعداد",
    again: "ابدأ من جديد (امسح من الذاكرة)",
    copied: "تم النسخ",
    notStored: "لا يُخزَّن أي شيء هنا. مغادرة الصفحة أو إعادة تحميلها تمحو المفاتيح من الذاكرة.",
    generatedOffline: "توليد محلي في هذا التبويب",
  },
};

const FIRST_ADDR_PATH = "m/84'/0'/0'/0/0";

interface WalletOut {
  mnemonic: string;
  paymentCode: string;
  accountZpub: string;
  firstAddress: string;
  wifScan: string;
  wifSpend: string;
}

function buildWallet(mnemonic: string): WalletOut {
  const seed = seedFromMnemonic(mnemonic);
  const k = deriveWalletKeys(seed);
  // first liquid address for the zpub rail (sanity check against Sparrow/Electrum)
  const first = HDKey.fromMasterSeed(seed).derive(FIRST_ADDR_PATH);
  if (!first.publicKey) throw new Error("derivation failed");
  return {
    mnemonic: normalizeMnemonic(mnemonic),
    paymentCode: k.paymentCode,
    accountZpub: k.accountZpub,
    firstAddress: pubkeyToBech32Address(first.publicKey),
    wifScan: toWIF(k.scanPriv),
    wifSpend: toWIF(k.spendPriv),
  };
}

export function ColdWallet() {
  const [lang, setLang] = useState<Lang>("en");
  const t = T[lang];
  const rtl = lang === "ar";

  const [mode, setMode] = useState<"generate" | "restore">("generate");
  const [words, setWords] = useState<12 | 24>(12);
  const [restoreInput, setRestoreInput] = useState("");
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWords, setShowWords] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  // honor ?lang= / localStorage like the rest of the node
  useEffect(() => {
    // Storage/URL reads run in a microtask — no synchronous setState in the effect body.
    queueMicrotask(() => {
      const q = new URLSearchParams(window.location.search).get("lang");
      if (q === "ar" || q === "en") setLang(q);
      else {
        const stored = window.localStorage.getItem("lp_lang");
        if (stored === "ar" || stored === "en") setLang(stored);
      }
    });
  }, []);

  const mnemonicWords = useMemo(() => (wallet ? wallet.mnemonic.split(" ") : []), [wallet]);

  function persistLang(next: Lang) {
    setLang(next);
    try {
      window.localStorage.setItem("lp_lang", next);
    } catch {
      /* private mode — fine */
    }
  }

  function onGenerate() {
    setError(null);
    try {
      setShowWords(true);
      setWallet(buildWallet(newMnemonic(words)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "generation failed");
    }
  }

  function onRestore() {
    setError(null);
    const m = normalizeMnemonic(restoreInput);
    if (!isValidMnemonic(m)) {
      setError(t.badMnemonic);
      return;
    }
    try {
      setShowWords(true);
      setWallet(buildWallet(m));
    } catch (e) {
      setError(e instanceof Error ? e.message : "restore failed");
    }
  }

  function wipe() {
    setWallet(null);
    setRestoreInput("");
    setError(null);
    setShowWords(true);
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard API can be denied; fall back to a hidden textarea select
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  }

  const fieldLabel = "mb-1.5 block text-sm font-medium text-foreground";
  const monoBox =
    "w-full break-all rounded-md border bg-muted/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground";
  const modeBtn = (active: boolean) =>
    `rounded-md border px-3 py-2.5 text-sm font-medium ${active ? "border-primary bg-primary/10" : "hover:bg-muted"}`;

  return (
    <div className="min-h-screen bg-background text-foreground" dir={rtl ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <ShieldCheck className="h-7 w-7 text-[#f7931a]" /> {t.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t.sub}</p>
          </div>
          <button
            onClick={() => persistLang(lang === "en" ? "ar" : "en")}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            {lang === "en" ? "العربية" : "English"}
          </button>
        </div>

        {/* offline guidance */}
        <div className="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <TriangleAlert className="h-4 w-4 text-amber-600" /> {t.offlineTitle}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t.offlineBody}</p>
        </div>

        {/* mode switch */}
        <div className="mb-6 grid grid-cols-2 gap-2">
          <button className={modeBtn(mode === "generate")} onClick={() => { setMode("generate"); setError(null); }}>
            {t.modeGenerate}
          </button>
          <button className={modeBtn(mode === "restore")} onClick={() => { setMode("restore"); setError(null); }}>
            {t.modeRestore}
          </button>
        </div>

        {/* input area */}
        {mode === "generate" ? (
          <div className="mb-6 flex flex-wrap items-end gap-3">
            <div>
              <span className={fieldLabel}>{t.words}</span>
              <div className="flex gap-2">
                {([12, 24] as const).map((n) => (
                  <button key={n} className={modeBtn(words === n)} onClick={() => setWords(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={onGenerate} className="gap-2">
              <KeyRound className="h-4 w-4" /> {t.generate}
            </Button>
          </div>
        ) : (
          <div className="mb-6">
            <span className={fieldLabel}>{t.restoring}</span>
            <textarea
              dir="ltr"
              rows={3}
              className={`${monoBox} mb-3`}
              placeholder={t.restorePlaceholder}
              value={restoreInput}
              onChange={(e) => setRestoreInput(e.target.value)}
            />
            <Button onClick={onRestore} className="gap-2">
              <RefreshCw className="h-4 w-4" /> {t.restore}
            </Button>
          </div>
        )}

        {error && <p className="mb-6 text-sm font-medium text-destructive">{error}</p>}

        {/* wallet output */}
        {wallet && (
          <div className="space-y-6">
            {/* mnemonic */}
            <section className="rounded-lg border p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold">{t.mnemonicTitle}</h2>
                <button
                  onClick={() => setShowWords((s) => !s)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showWords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showWords ? t.hide : t.reveal}
                </button>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-destructive">{t.mnemonicWarn}</p>
              <div className={showWords ? "grid grid-cols-2 gap-1.5 sm:grid-cols-3" : "blur-md select-none"}>
                {mnemonicWords.map((w, i) => (
                  <div key={i} dir="ltr" className="flex items-baseline gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                    <span className="w-5 shrink-0 text-right text-[10px] text-muted-foreground">{i + 1}</span>
                    <span className="font-mono text-sm font-semibold">{w}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => copy("mnemonic", wallet.mnemonic)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {copied === "mnemonic" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === "mnemonic" ? t.copied : "copy"}
              </button>
            </section>

            {/* payment code */}
            <section className="rounded-lg border p-4">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
                <Wallet className="h-4 w-4 text-[#f7931a]" /> {t.paycodeTitle}
              </h2>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t.paycodeNote}</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="shrink-0 rounded-md bg-white p-2.5">
                  <QRCodeSVG value={wallet.paymentCode} size={116} level="M" />
                </div>
                <div className="min-w-0 flex-1">
                  <div dir="ltr" className={monoBox}>{wallet.paymentCode}</div>
                  <button
                    onClick={() => copy("paycode", wallet.paymentCode)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {copied === "paycode" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === "paycode" ? t.copied : "copy"}
                  </button>
                </div>
              </div>
            </section>

            {/* zpub + first address */}
            <section className="rounded-lg border p-4">
              <h2 className="mb-1 text-sm font-bold">{t.zpubTitle}</h2>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t.zpubNote}</p>
              <div dir="ltr" className={monoBox}>{wallet.accountZpub}</div>
              <button
                onClick={() => copy("zpub", wallet.accountZpub)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {copied === "zpub" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === "zpub" ? t.copied : "copy"}
              </button>
              <div className="mt-4">
                <span className={fieldLabel}>{t.firstAddrTitle}</span>
                <div dir="ltr" className={`${monoBox} text-[13px]`}>{wallet.firstAddress}</div>
                <p className="mt-1.5 text-xs text-muted-foreground">{t.firstAddrNote}</p>
              </div>
            </section>

            {/* WIF (advanced) */}
            <section className="rounded-lg border p-4">
              <details>
                <summary className="cursor-pointer text-sm font-bold">{t.wifTitle}</summary>
                <p className="mb-3 mt-2 text-xs leading-relaxed text-muted-foreground">{t.wifNote}</p>
                <span className={fieldLabel}>{t.wifScan}</span>
                <div dir="ltr" className={monoBox}>{wallet.wifScan}</div>
                <div className="mt-3">
                  <span className={fieldLabel}>{t.wifSpend}</span>
                  <div dir="ltr" className={monoBox}>{wallet.wifSpend}</div>
                </div>
              </details>
            </section>

            {/* next step */}
            <section className="rounded-lg border border-[#f7931a]/40 bg-[#f7931a]/5 p-4">
              <h2 className="mb-1 text-sm font-bold">{t.nextTitle}</h2>
              <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{t.nextBody}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/setup?lang=${lang}`}>
                  <Button className="gap-2">{t.openSetup} →</Button>
                </Link>
                <Button variant="outline" onClick={wipe}>{t.again}</Button>
              </div>
            </section>

            <p className="text-center text-xs text-muted-foreground">🔒 {t.notStored}</p>
          </div>
        )}
      </div>
    </div>
  );
}
