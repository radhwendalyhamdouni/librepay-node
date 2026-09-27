"use client";

/**
 * LibrePay Node — first-run Setup Wizard & operator console.
 *
 * FIRST RUN (node unconfigured): a short interview — setup code → store
 * identity → receiving wallet (validated by deriving a REAL address) →
 * payment policy → backups → LAUNCH. One click and the node is live.
 *
 * AFTER SETUP: the same page is the operator console (API-key unlock):
 * status, backups (create / download / restore / off-server SSH target),
 * and API-key rotation. No accounts — the key IS the operator.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type Lang = "en" | "ar";

const T = {
  en: {
    title: "LibrePay Node",
    subtitle: "First-run setup — five questions and you are live.",
    welcome: "Welcome",
    welcomeBody:
      "This wizard configures your node and nothing else. No account is created — the node stays a single config file you own.",
    tokenWhere: "Your setup code proves you have server access. Find it with:",
    tokenLabel: "Setup code",
    tokenPlaceholder: "xxxx-xxxx-xxxx-xxxx",
    store: "Store identity",
    storeName: "Store name",
    brandColor: "Brand color",
    wallet: "Receiving wallet",
    walletBody:
      "Watch-only — the node can SEE payments but can never spend. Funds land directly in your own wallet.",
    zpub: "zpub / xpub (BIP84)",
    paymentcode: "Payment code (BIP47)",
    walletValue: "Paste your key",
    policy: "Payment policy",
    confirmations: "Confirmations required",
    expiry: "Invoice expiry",
    minutes: "min",
    extras: "Backups & extras (optional)",
    backupsOn: "Periodic backups",
    interval: "Every",
    hours: "h",
    retain: "Keep last",
    copies: "copies",
    remote: "Off-server copy (SSH)",
    remoteHint: "user@host:/path — pushed with scp (encrypted transport)",
    passphrase: "Backup passphrase (AES-256-GCM)",
    webhook: "Webhook URL (https)",
    lightning: "Lightning via phoenixd",
    baseUrl: "Public base URL",
    review: "Review",
    launch: "LAUNCH NODE",
    launching: "Launching…",
    live: "Your node is live",
    saveKey: "I saved the API key (it will never be shown again)",
    apiKeyOnce: "API key — shown once",
    webhookSecretOnce: "Webhook secret — shown once",
    proof: "Your node sees this wallet at",
    goFront: "Open your node",
    manage: "Operator console",
    unlock: "Unlock with API key",
    keyPlaceholder: "lp_live_…",
    status: "Status",
    invoices: "Invoices",
    paid: "Paid",
    walletMode: "Wallet",
    backupNow: "Backup now",
    pushRemote: "also push off-server",
    download: "download",
    restore: "restore",
    restoreHint: "staged — apply with: npm run restore, then restart",
    upload: "Upload .lplbackup",
    rotate: "Rotate API key",
    logout: "Lock",
    save: "Save",
    test: "Save & test push",
    clear: "Clear",
    saved: "Saved",
    errGeneric: "Something went wrong — check the details and retry.",
    confirmationsUnit: "confirmations",
    modeWatchonly: "watch-only (zpub)",
    modeSelfcustody: "stealth (payment code)",
    modeNone: "not configured",
    encrypted: "encrypted",
    plain: "no passphrase",
  },
  ar: {
    title: "LibrePay Node",
    subtitle: "إعداد أول تشغيل — خمسة أس وتصبح جاهزاً.",
    welcome: "أهلاً بك",
    welcomeBody:
      "هذا المعالج يضبط عقدتك ولا ينشئ أي حساب — العقدة تبقى ملف إعدادات واحداً تملكه أنت.",
    tokenWhere: "رمز الإعداد يثبت أن لك وصولاً للخادم. اعثر عليه بأمر:",
    tokenLabel: "رمز الإعداد",
    tokenPlaceholder: "xxxx-xxxx-xxxx-xxxx",
    store: "هوية المتجر",
    storeName: "اسم المتجر",
    brandColor: "لون العلامة",
    wallet: "محفظة الاستقبال",
    walletBody: "مراقِبة فقط — العقدة ترى الدفعات ولا تستطيع الإنفاق أبداً. الأموال تذهب لمحفظتك مباشرة.",
    zpub: "zpub / xpub (BIP84)",
    paymentcode: "رمز دفع (BIP47)",
    walletValue: "الصق مفتاحك",
    policy: "سياسة الدفع",
    confirmations: "التأكيدات المطلوبة",
    expiry: "صلاحية الفاتورة",
    minutes: "دقيقة",
    extras: "النسخ الاحتياطي والإضافات (اختياري)",
    backupsOn: "نسخ دورية",
    interval: "كل",
    hours: "ساعة",
    retain: "احتفظ بآخر",
    copies: "نسخة",
    remote: "نسخة على خادم خارجي (SSH)",
    remoteHint: "user@host:/path — تُدفع بـscp (نقل مشفّر)",
    passphrase: "عبارة تشفير النسخ (AES-256-GCM)",
    webhook: "رابط الويب‌هوك (https)",
    lightning: "لايتنين عبر phoenixd",
    baseUrl: "العنوان العام للعقدة",
    review: "مراجعة",
    launch: "تشغيل العقدة",
    launching: "جارٍ التشغيل…",
    live: "عقدتك تعمل الآن",
    saveKey: "حفظت مفتاح API (لن يُعرض مرة أخرى أبداً)",
    apiKeyOnce: "مفتاح API — يُعرض مرة واحدة",
    webhookSecretOnce: "سر الويب‌هوك — يُعرض مرة واحدة",
    proof: "عقدتك ترى هذه المحفظة على العنوان",
    goFront: "افتح عقدتك",
    manage: "لوحة المشغّل",
    unlock: "افتح بمفتاح API",
    keyPlaceholder: "lp_live_…",
    status: "الحالة",
    invoices: "فواتير",
    paid: "مدفوعة",
    walletMode: "المحفظة",
    backupNow: "نسخة الآن",
    pushRemote: "ودفعها للخارج",
    download: "تنزيل",
    restore: "استرجاع",
    restoreHint: "تم الترحيل — طبّق بـ: npm run restore ثم أعد التشغيل",
    upload: "ارفع ملف .lplbackup",
    rotate: "تدوير مفتاح API",
    logout: "قفل",
    save: "حفظ",
    test: "حفظ واختبار الدفع",
    clear: "مسح",
    saved: "حُفظ",
    errGeneric: "حدث خطأ — تحقق من التفاصيل وأعد المحاولة.",
    confirmationsUnit: "تأكيدات",
    modeWatchonly: "مراقِبة (zpub)",
    modeSelfcustody: "ستيلث (رمز دفع)",
    modeNone: "غير مضبوطة",
    encrypted: "مشفّرة",
    plain: "بدون عبارة تشفير",
  },
} as const;

interface StatusPayload {
  configured: boolean;
}
interface SystemStatus {
  store: { name: string; brandColor: string };
  wallet: { mode: string; confirmationsRequired: number; invoiceExpiryMinutes: number; lightning: string };
  counts: { invoices: number; paid: number };
  backup: {
    lastBackupAt: string | null;
    lastRemotePushAt: string | null;
    lastRemoteError: string | null;
    count: number;
    totalBytes: number;
    encrypted: boolean;
    enabled: boolean;
    intervalHours: number;
    remoteTarget: string;
  };
}

const STEP_TITLES = ["welcome", "tokenLabel", "store", "wallet", "policy", "extras", "review"] as const;

export default function SetupWizard() {
  const [lang, setLang] = useState<Lang>("en");
  const t = T[lang];
  const [phase, setPhase] = useState<"loading" | "wizard" | "manage" | "done">("loading");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dir = lang === "ar" ? "rtl" : "ltr";

  // form state
  const [setupToken, setSetupToken] = useState("");
  const [storeName, setStoreName] = useState("");
  const [brandColor, setBrandColor] = useState("#f7931a");
  const [walletKind, setWalletKind] = useState<"zpub" | "paymentcode">("zpub");
  const [walletValue, setWalletValue] = useState("");
  const [confirmations, setConfirmations] = useState(2);
  const [expiry, setExpiry] = useState(15);
  const [backupsOn, setBackupsOn] = useState(true);
  const [intervalH, setIntervalH] = useState(24);
  const [retain, setRetain] = useState(14);
  const [remote, setRemote] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // done state
  const [result, setResult] = useState<{ apiKey: string; webhookSecret: string | null; proofAddress: string; walletMode: string } | null>(null);
  const [savedChecked, setSavedChecked] = useState(false);

  // manage state
  const [apiKey, setApiKey] = useState("");
  const [sys, setSys] = useState<SystemStatus | null>(null);
  const [backups, setBackups] = useState<{ name: string; bytes: number; mtime: string }[]>([]);
  const [stagedHint, setStagedHint] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((s: StatusPayload) => setPhase(s.configured ? "manage" : "wizard"))
      .catch(() => setPhase("wizard"));
  }, []);

  const loadManage = useCallback(
    async (key: string) => {
      const r = await fetch("/api/system/status", { headers: { Authorization: `Bearer ${key}` } });
      if (r.status === 401) {
        setError(t.errGeneric);
        return false;
      }
      const data = (await r.json()) as SystemStatus;
      setSys(data);
      const bl = await fetch("/api/system/backup", { headers: { Authorization: `Bearer ${key}` } });
      const bd = await bl.json();
      setBackups(bd.backups ?? []);
      return true;
    },
    [t]
  );

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupToken: setupToken.trim(),
          storeName: storeName.trim(),
          brandColor,
          wallet: { kind: walletKind, value: walletValue.trim() },
          confirmationsRequired: confirmations,
          invoiceExpiryMinutes: expiry,
          baseUrl,
          webhookUrl: webhookUrl.trim() || undefined,
          backup: {
            enabled: backupsOn,
            intervalHours: intervalH,
            retain,
            remoteTarget: remote.trim(),
            remotePort: 22,
            passphrase: passphrase || "",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data?.detail || data?.hint || (data?.issues?.[0]?.message ?? "");
        setError(`${data?.error ?? "ERROR"}${detail ? ` — ${detail}` : ""}`);
        if (data?.error === "WALLET_REJECTED") setStep(3);
        if (data?.error === "SETUP_TOKEN_REQUIRED") setStep(1);
        return;
      }
      setResult({
        apiKey: data.apiKey ?? "",
        webhookSecret: data.webhookSecret,
        proofAddress: data.proofAddress,
        walletMode: data.walletMode,
      });
      setPhase("done");
    } finally {
      setBusy(false);
    }
  }

  async function backupNow(push: boolean) {
    setBusy(true);
    await fetch("/api/system/backup", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pushRemote: push }),
    });
    await loadManage(apiKey);
    setBusy(false);
  }

  async function download(name: string) {
    const r = await fetch(`/api/system/backup/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function restore(name: string) {
    setBusy(true);
    const r = await fetch("/api/system/backup/restore", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    setStagedHint(r.ok ? d?.staged?.nextStep ?? t.restoreHint : d?.error ?? t.errGeneric);
    setBusy(false);
  }

  async function restoreUpload(file: File) {
    setBusy(true);
    const r = await fetch("/api/system/backup/restore", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/octet-stream", "x-backup-name": file.name },
      body: await file.arrayBuffer(),
    });
    const d = await r.json();
    setStagedHint(r.ok ? d?.staged?.nextStep ?? t.restoreHint : d?.error ?? t.errGeneric);
    setBusy(false);
  }

  async function saveRemote() {
    setBusy(true);
    await fetch("/api/system/backup/remote", {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ remoteTarget: remote.trim(), remotePort: 22, passphrase: passphrase || undefined }),
    });
    await loadManage(apiKey);
    setBusy(false);
  }

  async function rotate() {
    setBusy(true);
    const r = await fetch("/api/setup/rotate-key", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } });
    const d = await r.json();
    if (r.ok) {
      setNewKey(d.apiKey);
      setApiKey(d.apiKey);
    }
    setBusy(false);
  }

  // ── shared bits ───────────────────────────────────────────────────────────
  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="w-full max-w-xl rounded-2xl border bg-card p-6 sm:p-8 shadow-lg">
      {children}
    </div>
  );
  const label = "mb-1.5 block text-sm font-medium text-foreground";
  const input =
    "w-full rounded-md border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";

  if (phase === "loading") {
    return <main className="min-h-screen grid place-items-center bg-background text-muted-foreground">…</main>;
  }

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (phase === "done" && result) {
    return (
      <main dir={dir} className="min-h-screen bg-background text-foreground grid place-items-center p-6">
        <Card>
          <div className="flex justify-center mb-4">
            <Image src="/brand/logo-lockup.png" alt="LibrePay" width={220} height={62} priority />
          </div>
          <h1 className="text-2xl font-bold text-center mb-1">✓ {t.live}</h1>
          <p className="text-center text-sm text-muted-foreground mb-6">
            {t.proof} <code className="font-mono text-xs">{result.proofAddress}</code>
          </p>
          {result.apiKey && (
            <div className="mb-4">
              <span className={label}>🔑 {t.apiKeyOnce}</span>
              <div className="flex gap-2">
                <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
                  {result.apiKey}
                </code>
                <button className="rounded-md border px-3 text-sm hover:bg-muted" onClick={() => navigator.clipboard.writeText(result.apiKey)}>⧉</button>
              </div>
            </div>
          )}
          {result.webhookSecret && (
            <div className="mb-4">
              <span className={label}>🔐 {t.webhookSecretOnce}</span>
              <code className="block rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">{result.webhookSecret}</code>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm mb-6 cursor-pointer">
            <input type="checkbox" checked={savedChecked} onChange={(e) => setSavedChecked(e.target.checked)} />
            {t.saveKey}
          </label>
          <div className="flex justify-center">
            <Link
              href="/"
              className={`rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 ${savedChecked ? "" : "pointer-events-none opacity-40"}`}
            >
              {t.goFront} →
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  // ── MANAGE ────────────────────────────────────────────────────────────────
  if (phase === "manage") {
    return (
      <main dir={dir} className="min-h-screen bg-background text-foreground p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="flex items-center justify-between">
            <Image src="/brand/logo-lockup.png" alt="LibrePay" width={190} height={54} priority />
            <button
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
              onClick={() => { setApiKey(""); setSys(null); }}
            >
              {sys ? `🔒 ${t.logout}` : ""}
            </button>
          </div>

          {!sys ? (
            <Card>
              <h1 className="text-xl font-bold mb-4">{t.manage}</h1>
              <span className={label}>{t.unlock}</span>
              <input
                dir="ltr"
                className={`${input} font-mono`}
                placeholder={t.keyPlaceholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                className="mt-4 w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:opacity-90"
                onClick={async () => { setBusy(true); setError(null); const ok = await loadManage(apiKey.trim()); if (!ok) setError(t.errGeneric); setBusy(false); }}
                disabled={busy}
              >
                {t.unlock} →
              </button>
              {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
              <p className="mt-4 text-xs text-muted-foreground">
                {lang === "ar" ? "لا يوجد حساب — المفتاح هو هويتك." : "No account exists — the key is your identity."}
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <h1 className="text-lg font-bold mb-3">{t.status}</h1>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-lg border p-3"><div className="text-muted-foreground">{t.storeName}</div><div className="font-semibold truncate">{sys.store.name}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-muted-foreground">{t.walletMode}</div><div className="font-semibold">{sys.wallet.mode === "watchonly" ? t.modeWatchonly : sys.wallet.mode === "selfcustody" ? t.modeSelfcustody : t.modeNone}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-muted-foreground">{t.invoices}</div><div className="font-semibold">{sys.counts.invoices}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-muted-foreground">{t.paid}</div><div className="font-semibold">{sys.counts.paid}</div></div>
                </div>
              </Card>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-bold">💾 {lang === "ar" ? "النسخ الاحتياطي" : "Backups"}</h2>
                  <span className="text-xs text-muted-foreground">
                    {sys.backup.count} · {Math.round(sys.backup.totalBytes / 1024)} KB ·{" "}
                    {sys.backup.encrypted ? `🔒 ${t.encrypted}` : t.plain}
                  </span>
                </div>
                {sys.backup.lastBackupAt && (
                  <p className="text-xs text-muted-foreground mb-3">
                    last: {new Date(sys.backup.lastBackupAt).toLocaleString()}
                    {sys.backup.lastRemotePushAt ? ` · pushed: ${new Date(sys.backup.lastRemotePushAt).toLocaleString()}` : ""}
                    {sys.backup.lastRemoteError ? ` · ⚠ ${sys.backup.lastRemoteError}` : ""}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mb-4">
                  <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90" disabled={busy} onClick={() => backupNow(false)}>
                    {t.backupNow}
                  </button>
                  {sys.backup.remoteTarget && (
                    <button className="rounded-md border px-4 py-2 text-sm hover:bg-muted" disabled={busy} onClick={() => backupNow(true)}>
                      ⇪ {t.pushRemote}
                    </button>
                  )}
                  <button className="rounded-md border px-4 py-2 text-sm hover:bg-muted" disabled={busy} onClick={() => fileRef.current?.click()}>
                    {t.upload}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".lplbackup"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void restoreUpload(f); }}
                  />
                </div>
                {stagedHint && <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">⚠ {stagedHint}</p>}
                <ul className="space-y-1.5">
                  {backups.map((b) => (
                    <li key={b.name} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span className="truncate font-mono text-xs">{b.name}</span>
                      <span className="flex gap-2">
                        <button className="rounded border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => download(b.name)}>{t.download}</button>
                        <button className="rounded border px-2 py-0.5 text-xs hover:bg-muted" disabled={busy} onClick={() => restore(b.name)}>{t.restore}</button>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 border-t pt-4">
                  <h3 className="mb-2 text-sm font-semibold">{t.remote}</h3>
                  <input dir="ltr" className={`${input} mb-2 font-mono text-xs`} placeholder={t.remoteHint} value={remote} onChange={(e) => setRemote(e.target.value)} />
                  <input dir="ltr" type="password" className={`${input} mb-2 font-mono text-xs`} placeholder={t.passphrase} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  <div className="flex gap-2">
                    <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" disabled={busy} onClick={saveRemote}>{t.test}</button>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">🔑 {t.rotate}</h2>
                  <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" disabled={busy} onClick={rotate}>{t.rotate}</button>
                </div>
                {newKey && (
                  <code className="mt-3 block rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">{newKey}</code>
                )}
              </Card>
              <div className="pb-8 text-center">
                <Link href="/" className="text-xs text-muted-foreground underline">← {t.goFront}</Link>
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  // ── WIZARD ────────────────────────────────────────────────────────────────
  const canNext =
    (step === 0) ||
    (step === 1 && setupToken.trim().length >= 8) ||
    (step === 2 && storeName.trim().length >= 1) ||
    (step === 3 && walletValue.trim().length >= 20) ||
    step === 4 || step === 5;

  return (
    <main dir={dir} className="min-h-screen bg-background text-foreground grid place-items-center p-6">
      <Card>
        <div className="flex items-center justify-between mb-5">
          <Image src="/brand/logo-lockup.png" alt="LibrePay" width={170} height={48} priority />
          <button
            className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
          >
            {lang === "en" ? "العربية" : "English"}
          </button>
        </div>

        {/* progress */}
        <div className="mb-6 flex gap-1.5">
          {STEP_TITLES.map((_, i) => (
            <div key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i <= step ? brandColor : "var(--muted)" }} />
          ))}
        </div>

        {error && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {step === 0 && (
          <>
            <h1 className="text-2xl font-bold mb-2">{t.welcome} 👋</h1>
            <p className="text-sm text-muted-foreground mb-6">{t.welcomeBody}</p>
            <ul className="space-y-2 text-sm">
              <li className="rounded-lg border p-3">🔒 {lang === "ar" ? "مفاتيح الإنفاق لا تلمس الخادم أبداً — مراقِبة فقط." : "Spending keys never touch the server — watch-only by design."}</li>
              <li className="rounded-lg border p-3">🚫 {lang === "ar" ? "لا حسابات، لا KYC، لا بريد." : "No accounts, no KYC, no email."}</li>
              <li className="rounded-lg border p-3">⚡ {lang === "ar" ? "خمسة أسئلة وتبدأ باستقبال البيتكوين." : "Five questions and you are receiving Bitcoin."}</li>
            </ul>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="text-xl font-bold mb-1">🔑 {t.tokenLabel}</h1>
            <p className="mb-4 text-sm text-muted-foreground">{t.tokenWhere}</p>
            <code dir="ltr" className="mb-4 block rounded-md border bg-muted px-3 py-2 font-mono text-xs">
              cat data/SETUP_TOKEN
            </code>
            <span className={label}>{t.tokenLabel}</span>
            <input dir="ltr" className={`${input} font-mono`} placeholder={t.tokenPlaceholder} value={setupToken} onChange={(e) => setSetupToken(e.target.value)} />
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="text-xl font-bold mb-4">🏪 {t.store}</h1>
            <span className={label}>{t.storeName}</span>
            <input className={`${input} mb-4`} placeholder="Satoshi Coffee" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
            <span className={label}>{t.brandColor}</span>
            <div className="flex items-center gap-3">
              <input type="color" className="h-10 w-14 cursor-pointer rounded-md border" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
              <code className="font-mono text-sm">{brandColor}</code>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-xl font-bold mb-1">👛 {t.wallet}</h1>
            <p className="mb-4 text-sm text-muted-foreground">{t.walletBody}</p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {(["zpub", "paymentcode"] as const).map((k) => (
                <button
                  key={k}
                  className={`rounded-md border px-3 py-2.5 text-sm font-medium ${walletKind === k ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                  onClick={() => setWalletKind(k)}
                >
                  {k === "zpub" ? t.zpub : t.paymentcode}
                </button>
              ))}
            </div>
            <span className={label}>{t.walletValue}</span>
            <textarea
              dir="ltr"
              rows={3}
              className={`${input} font-mono text-xs`}
              placeholder={walletKind === "zpub" ? "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs" : "PM8TJS2JxQ5ztXupBBkyjLYs…"}
              value={walletValue}
              onChange={(e) => setWalletValue(e.target.value)}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              {lang === "ar" ? "لا تملك محفظة بعد؟ ولّد واحدة باردة في متصفحك — " : "No wallet yet? Generate a cold one in your browser — "}
              <Link href={`/cold?lang=${lang}`} className="font-medium text-primary underline underline-offset-2">
                {lang === "ar" ? "مولّد المحفظة الباردة" : "Cold Wallet generator"}
              </Link>
              {lang === "ar" ? " (يعمل دون اتصال)." : " (works offline)."}
            </p>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className="text-xl font-bold mb-4">⏱ {t.policy}</h1>
            <span className={label}>
              {t.confirmations}: <b>{confirmations}</b> {t.confirmationsUnit}
            </span>
            <input type="range" min={1} max={6} value={confirmations} onChange={(e) => setConfirmations(Number(e.target.value))} className="mb-6 w-full accent-[var(--primary)]" />
            <span className={label}>{t.expiry}</span>
            <div className="flex flex-wrap gap-2">
              {[5, 15, 30, 60, 120].map((m) => (
                <button
                  key={m}
                  className={`rounded-md border px-4 py-2 text-sm ${expiry === m ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted"}`}
                  onClick={() => setExpiry(m)}
                >
                  {m} {t.minutes}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h1 className="text-xl font-bold mb-4">💾 {t.extras}</h1>
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={backupsOn} onChange={(e) => setBackupsOn(e.target.checked)} /> {t.backupsOn}
            </label>
            {backupsOn && (
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <span className={label}>{t.interval}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={168} className={input} value={intervalH} onChange={(e) => setIntervalH(Math.max(1, Math.min(168, Number(e.target.value) || 24)))} />
                    <span className="text-sm text-muted-foreground">{t.hours}</span>
                  </div>
                </div>
                <div>
                  <span className={label}>{t.retain}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={3} max={120} className={input} value={retain} onChange={(e) => setRetain(Math.max(3, Math.min(120, Number(e.target.value) || 14)))} />
                    <span className="text-sm text-muted-foreground">{t.copies}</span>
                  </div>
                </div>
                <div className="col-span-2">
                  <span className={label}>{t.remote}</span>
                  <input dir="ltr" className={`${input} mb-1 font-mono text-xs`} placeholder="backup@nas.local:/volume1/librepay" value={remote} onChange={(e) => setRemote(e.target.value)} />
                  <p className="mb-2 text-xs text-muted-foreground">{t.remoteHint}</p>
                  <input dir="ltr" type="password" className={`${input} font-mono text-xs`} placeholder={t.passphrase} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                </div>
              </div>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">{lang === "ar" ? "متقدم: ويب‌هوك ولايتنين" : "Advanced: webhook & Lightning"}</summary>
              <div className="mt-3">
                <span className={label}>{t.webhook}</span>
                <input dir="ltr" className={`${input} mb-3 font-mono text-xs`} placeholder="https://myshop.example.com/api/webhooks/librepay" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
                <span className={label}>{t.baseUrl}</span>
                <input dir="ltr" className={`${input} font-mono text-xs`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
            </details>
          </>
        )}

        {step === 6 && (
          <>
            <h1 className="text-xl font-bold mb-4">📋 {t.review}</h1>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between rounded-lg border px-3 py-2"><span className="text-muted-foreground">{t.storeName}</span><b>{storeName}</b></li>
              <li className="flex justify-between rounded-lg border px-3 py-2"><span className="text-muted-foreground">{t.wallet}</span><b className="truncate font-mono text-xs">{walletKind === "zpub" ? t.zpub : t.paymentcode}: {walletValue.slice(0, 14)}…</b></li>
              <li className="flex justify-between rounded-lg border px-3 py-2"><span className="text-muted-foreground">{t.confirmations}</span><b>{confirmations}</b></li>
              <li className="flex justify-between rounded-lg border px-3 py-2"><span className="text-muted-foreground">{t.expiry}</span><b>{expiry} {t.minutes}</b></li>
              <li className="flex justify-between rounded-lg border px-3 py-2"><span className="text-muted-foreground">{t.backupsOn}</span><b>{backupsOn ? `✓ ${intervalH}${t.hours} · ${retain} ${t.copies}${remote ? " · ⇪" : ""}` : "—"}</b></li>
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">{t.walletBody}</p>
          </>
        )}

        {/* nav */}
        <div className="mt-8 flex items-center justify-between">
          <button
            className="rounded-md border px-4 py-2.5 text-sm hover:bg-muted disabled:opacity-40"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0 || busy}
          >
            ←
          </button>
          {step < 6 ? (
            <button
              className="rounded-md bg-primary px-8 py-2.5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
              onClick={() => setStep(step + 1)}
              disabled={!canNext || busy}
            >
              {step === 0 ? (lang === "ar" ? "ابدأ" : "Start") : lang === "ar" ? "التالي" : "Next"} →
            </button>
          ) : (
            <button
              className="rounded-md px-8 py-2.5 font-bold text-white hover:opacity-90 disabled:opacity-50"
              style={{ background: brandColor }}
              onClick={launch}
              disabled={busy}
            >
              {busy ? t.launching : `🚀 ${t.launch}`}
            </button>
          )}
        </div>
      </Card>
    </main>
  );
}
