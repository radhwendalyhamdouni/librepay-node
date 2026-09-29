"use client";

/**
 * LibrePay Node — first-run Setup Wizard & operator console.
 *
 * FIRST RUN (node unconfigured): a short interview — setup code → store
 * identity → receiving wallet (validated by deriving a REAL address) →
 * payment policy → backups → LAUNCH. One click and the node is live.
 *
 * AFTER SETUP: the same page is the operator console (BTCPay-style login):
 * a console password (+ optional TOTP 2FA) opens an HTTP-only session; the
 * API key is for shop integrations only. Sensitive actions re-ask the
 * password (step-up). Sessions are listed and revocable live.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

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
    walletTitle: "Your wallet",
    walletExplain:
      "Watch-only — the node sees payments but can never spend. Every invoice derives a fresh address from YOUR key, and funds land directly in your wallet. To spend, use Sparrow, Electrum or BlueWallet — the node deliberately has no send button.",
    walletLastAddr: "Latest derived address",
    walletDerivations: "Addresses derived",
    walletZpubHelp: "Where is my zpub? Sparrow → Wallet → Information · Electrum → Wallet → Information · BlueWallet → wallet → ⋯ → Show xpub.",
    walletCold: "No wallet yet? Generate a cold one in your browser — works offline.",
    coldTool: "Cold Wallet generator",
    connectTitle: "Connect your store",
    connectIntro: "Three values and your shop accepts Bitcoin. Works with WooCommerce, any custom cart, or a plain curl.",
    connectBase: "1 · Node API base URL",
    connectKey: "2 · API key",
    connectKeyNote: "The same lp_live_… key you unlocked with. The node stores only its hash — keep a copy in your password manager.",
    connectHook: "3 · Webhook secret",
    connectHookNote: "Your store uses it to verify signed payment events (HMAC-SHA256). Never share it.",
    reveal: "reveal",
    hide: "hide",
    copy: "copy",
    copied: "copied ✓",
    hookUrls: "Webhook destinations — URLs on YOUR store that receive signed events",
    hookAdd: "https://your-store.com/wc-api/librepay_webhook",
    hookSave: "Save destinations",
    hookEmpty: "No destinations yet — add your store's webhook URL below.",
    hookRedrive: "Requeue dead deliveries",
    hookRedriveDone: "requeued — the retry schedule starts now",
    hookRedriveNone: "nothing to requeue — no dead deliveries",
    hookRedriveFail: "redrive failed — check you are still signed in",
    wooTitle: "WooCommerce (WordPress)",
    wooStep1: "Download the plugin, then in WordPress: Plugins → Add New → Upload Plugin.",
    wooStep2: "WooCommerce → Settings → Payments → “Bitcoin via LibrePay” → Enable.",
    wooStep3: "Paste the base URL, API key and webhook secret from above.",
    wooStep4: "Add your store's webhook URL in “Webhook destinations” below so the node can notify WooCommerce.",
    wooStep5: "Place a test order — the order marks itself paid on the first confirmed block.",
    downloadPlugin: "⇩ Download WooCommerce plugin (.zip)",
    curlTitle: "Or create invoices from your own code",
    invoicesTitle: "Recent invoices",
    invoicesEmpty: "No invoices yet — create the first one from your store or with the curl above.",
    invOrder: "Order",
    invAmount: "Amount",
    invStatus: "Status",
    openCheckout: "checkout ↗",
    // badges — every function labeled honestly
    badgeRequired: "required",
    badgeOptional: "optional",
    badgeRecommended: "recommended",
    // privacy modes
    privacyTitle: "Privacy mode",
    privacyIntro: "Choose how your money moves. Change it anytime — the on-chain stealth rail is ALWAYS on.",
    privacyStandard: "Standard",
    privacyStandardDesc: "Convenience first — Lightning pays instantly when connected; on-chain stealth otherwise.",
    privacyBalanced: "Balanced",
    privacyBalancedDesc: "Recommended — on-chain stealth always; Lightning helps for small fast amounts.",
    privacyMaximum: "Maximum privacy",
    privacyMaximumDesc: "On-chain stealth / payment-code ONLY. Lightning fully disabled. Nothing but public keys ever leaves your server.",
    privacyNow: "current",
    // lightning management
    lnTitle: "Lightning (optional)",
    lnIntro: "Instant settlement for small amounts via YOUR own phoenixd. The node works fully without it. In Maximum-privacy mode it is ignored.",
    lnUrl: "phoenixd URL",
    lnPassword: "phoenixd http-password",
    lnConnect: "Connect & test",
    lnConnected: "Connected ✓",
    lnDisconnected: "Not connected — on-chain only",
    lnNote: "Tested live before saving · password stored encrypted (AES-256-GCM) · keep the channel balance small — big invoices stay on-chain.",
    lnDisconnect: "Disconnect",
    // security
    secTitle: "Security & monitoring",
    secEnc: "Encryption at rest",
    secMonitor: "Live monitor",
    secAuto: "auto-refresh 15s",
    secEncryptNow: "Encrypt secrets now",
    secPurge: "Clear log",
    secAlert: "Multiple failed unlock attempts in the last 24h. If this isn't you, rotate the API key NOW.",
    secChecklist: "Server hardening checklist",
    secEvents24: "24h:",
    secFailed: "failed unlocks",
    secThrottled: "throttled",
    secBlocked: "SSRF blocked",
    // console login (v0.5.0) — human credential, BTCPay-style
    loginTitle: "Operator login",
    loginBody:
      "Your console password is the human credential. The API key stays with your shop integration — it never enters a browser again.",
    loginPassword: "Console password",
    loginTotp: "6-digit authenticator code",
    trustDevice: "Trust this device for 30 days",
    loginBtn: "Unlock console",
    firstRunTitle: "Create your console password",
    firstRunBody:
      "Paste the operator API key once — this is the last time it ever touches a browser. Then choose a password (and optionally 2FA).",
    firstRunKey: "Operator API key (once)",
    firstRunPw: "New console password (min 10 chars)",
    firstRunPw2: "Repeat the password",
    firstRunSave: "Create password",
    firstRunTotpTitle: "Add 2FA (recommended)",
    firstRunTotpSkip: "Skip for now — add it later in Security",
    firstRunTotpScan: "Scan with Google Authenticator / Aegis / 1Password, then enter the current 6-digit code:",
    firstRunDone: "Credentials ready ✓",
    totpCard: "Two-factor (TOTP)",
    totpOn: "2FA is active — every console login needs your authenticator code.",
    totpEnable: "Enable 2FA",
    totpScan: "Scan with your authenticator app, then enter the current 6-digit code:",
    totpConfirmBtn: "Verify & activate",
    totpDisable: "Disable 2FA",
    stepUpTitle: "Sensitive action — confirm it's you",
    stepUpBody:
      "This operation can move payments or rotate secrets. Re-enter your console password to continue.",
    stepUpBtn: "Confirm",
    sessionsTitle: "Signed-in sessions",
    sessionsNote: "HTTP-only cookie · sliding expiry · revocable",
    sessionRevoke: "revoke",
    sessionRevokeAll: "Sign out everywhere else",
    sessionsEmpty: "No other active sessions.",
    sessionThisDevice: "this device",
    sessionMethodLink: "recovery link",
    sessionMethodKey: "api key",
    sessionMethodPassword: "password",
    sessionMethodFirstrun: "first-run",
    claimFailed:
      "That recovery link expired or was already used. Mint a new one on the server: bun run console:link",
    claimOk: "Signed in via recovery link ✓ — set a password or continue straight to the console.",
    lockedOut: "Too many attempts — locked. Retry in {s}s.",
    recoveryNote: "Lost your password? On the server run: bun run console:link and open the printed link.",
    pwMismatch: "Passwords do not match.",
    pwCurrent: "Current password",
    pwNew: "New password (min 10 chars)",
    pwChangeBtn: "Change password",
    connectKeyMasked:
      "Shown once at setup — the node stores only its hash. Lost your copy? “Rotate API key” below mints a new one.",
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
    walletTitle: "محفظتك",
    walletExplain:
      "مراقِبة فقط — العقدة ترى الدفعات ولا تستطيع الإنفاق أبداً. كل فاتورة تُشتق عنواناً جديداً من مفتاحك أنت، والأموال تهبط مباشرة في محفظتك. للإنفاق استخدم Sparrow أو Electrum أو BlueWallet — العقدة بلا زر إرسال عمداً.",
    walletLastAddr: "أحدث عنوان مُشتق",
    walletDerivations: "عناوين مُشتقة",
    walletZpubHelp: "أين أجد zpub؟ Sparrow → Wallet → Information · Electrum → Wallet → Information · BlueWallet → المحفظة → ⋯ → Show xpub.",
    walletCold: "لا تملك محفظة بعد؟ ولّد واحدة باردة في متصفحك — تعمل دون اتصال.",
    coldTool: "مولّد المحفظة الباردة",
    connectTitle: "اربط متجرك",
    connectIntro: "ثلاث قيم ويقبل متجرك البيتكوين. يعمل مع ووكومرس وأي سلة مخصصة أو حتى سطر أوامر واحد.",
    connectBase: "1 · عنوان العقدة الأساسي",
    connectKey: "2 · مفتاح API",
    connectKeyNote: "نفس مفتاح lp_live_… الذي فتحت به الكونسول. العقدة تحفظ بصمة sha256 فقط — احفظ نسخة في مدير كلمات المرور.",
    connectHook: "3 · سرّ الويبهوك",
    connectHookNote: "يستخدمه متجرك للتحقق من أحداث الدفع الموقّعة (HMAC-SHA256). لا تشاركه أبداً.",
    reveal: "إظهار",
    hide: "إخفاء",
    copy: "نسخ",
    copied: "نُسخ ✓",
    hookUrls: "وجهات الويبهوك — روابط على متجرك تستقبل الأحداث الموقّعة",
    hookAdd: "https://your-store.com/wc-api/librepay_webhook",
    hookSave: "حفظ الوجهات",
    hookEmpty: "لا وجهات بعد — أضف رابط ويبهوك متجرك أدناه.",
    hookRedrive: "إعادة إرسال الفواتير الميتة",
    hookRedriveDone: "أُعيد طابورها — جدول المحاولات يبدأ الآن",
    hookRedriveNone: "لا شيء لإعادة الإرسال — لا فواتير ميتة",
    hookRedriveFail: "فشل إعادة الإرسال — تأكد أن جلستك ما تزال حية",
    wooTitle: "ووكومرس (ووردبريس)",
    wooStep1: "حمّل الإضافة ثم في ووردبريس: إضافات → أضف جديد → ارفع الإضافة.",
    wooStep2: "ووكومرس → الإعدادات → الدفعات ← «Bitcoin via LibrePay» ← تمكين.",
    wooStep3: "الصق عنوان العقدة ومفتاح API وسرّ الويبهوك من الأعلى.",
    wooStep4: "أضف رابط ويبهوك متجرك في «وجهات الويبهوك» أدناه لتصلك إشعارات الدفع.",
    wooStep5: "أنشئ طلباً تجريبياً — يُعلَّم مدفوعاً تلقائياً عند أول تأكيد على السلسلة.",
    downloadPlugin: "⇩ تحميل إضافة ووكومرس (.zip)",
    curlTitle: "أو أنشئ الفواتير من كودك مباشرة",
    invoicesTitle: "أحدث الفواتير",
    invoicesEmpty: "لا فواتير بعد — أنشئ الأولى من متجرك أو بأمر curl أعلاه.",
    invOrder: "الطلب",
    invAmount: "المبلغ",
    invStatus: "الحالة",
    openCheckout: "صفحة الدفع ↗",
    // الشارات — كل وظيفة موسومة بصدق
    badgeRequired: "مطلوب",
    badgeOptional: "اختياري",
    badgeRecommended: "مستحسن",
    // مستويات الخصوصية
    privacyTitle: "مستوى الخصوصية",
    privacyIntro: "اختر كيف تتحرك أموالك. غيّره متى شئت — سكة الستيلث على السلسلة تعمل دائماً.",
    privacyStandard: "عادي",
    privacyStandardDesc: "الراحة أولاً — لايتنينغ يدفع فوراً عند الاتصال، وإلا ستيلث على السلسلة.",
    privacyBalanced: "متوازن",
    privacyBalancedDesc: "مستحسن — ستيلث على السلسلة دائماً؛ ولايتنينغ يساعد للمبالغ الصغيرة السريعة.",
    privacyMaximum: "خصوصية فائقة",
    privacyMaximumDesc: "ستيلث/رمز الدفع على السلسلة فقط. لايتنينغ معطّل كلياً. لا يخرج من سيرفرك سوى المفاتيح العامة.",
    privacyNow: "الحالي",
    // إدارة لايتنينغ
    lnTitle: "لايتنينغ (اختياري)",
    lnIntro: "تسوية فورية للمبالغ الصغيرة عبر phoenixd الخاص بك. العقدة تعمل كاملة بدونه. ويُتجاهل في وضع الخصوصية الفائقة.",
    lnUrl: "رابط phoenixd",
    lnPassword: "كلمة http-password لـ phoenixd",
    lnConnect: "ربط واختبار",
    lnConnected: "متصل ✓",
    lnDisconnected: "غير متصل — السلسلة فقط",
    lnNote: "يُختبر مباشرة قبل الحفظ · كلمة السر تُخزن مشفرة (AES-256-GCM) · أبقِ رصيد القناة صغيراً — الفواتير الكبيرة تبقى على السلسلة.",
    lnDisconnect: "فصل",
    // الأمان
    secTitle: "الأمان والمراقبة",
    secEnc: "التشفير في التخزين",
    secMonitor: "المراقب الحي",
    secAuto: "تحديث تلقائي كل 15 ثانية",
    secEncryptNow: "شفّر الأسرار الآن",
    secPurge: "تفريغ السجل",
    secAlert: "محاولات فتح فاشلة متعددة آخر 24 ساعة. إن لم تكن أنت، دوّر مفتاح API فوراً.",
    secChecklist: "قائمة تقوية الخادم",
    secEvents24: "٢٤ ساعة:",
    secFailed: "فشل فتح",
    secThrottled: "خنق",
    secBlocked: "حجب SSRF",
    // دخول الكونسول (v0.5.0) — هوية الإنسان بنموذج BTCPay
    loginTitle: "دخول المشغّل",
    loginBody:
      "كلمة مرور الكونسول هي هويتك كإنسان. مفتاح API يبقى مع متجرك — لا يدخل المتصفح مرة أخرى.",
    loginPassword: "كلمة مرور الكونسول",
    loginTotp: "رمز المصادقة من 6 أرقام",
    trustDevice: "ثق بهذا الجهاز لمدة 30 يوماً",
    loginBtn: "افتح الكونسول",
    firstRunTitle: "أنشئ كلمة مرور الكونسول",
    firstRunBody:
      "الصق مفتاح API مرة واحدة — هذه آخر مرة يلمس فيها المتصفح. ثم اختر كلمة مرور (واختيارياً 2FA).",
    firstRunKey: "مفتاح API للمشغّل (مرة واحدة)",
    firstRunPw: "كلمة المرور الجديدة (10 أحرف فأكثر)",
    firstRunPw2: "أعد كلمة المرور",
    firstRunSave: "أنشئ كلمة المرور",
    firstRunTotpTitle: "أضف التحقق الثنائي (مستحسن)",
    firstRunTotpSkip: "تخطَّ الآن — أضفه لاحقاً من قسم الأمان",
    firstRunTotpScan: "امسح بـ Google Authenticator أو Aegis أو 1Password ثم أدخل الرمز الحالي من 6 أرقام:",
    firstRunDone: "بيانات الاعتماد جاهزة ✓",
    totpCard: "التحقق الثنائي (TOTP)",
    totpOn: "التحقق الثنائي مفعّل — كل دخول للكونسول يحتاج رمز تطبيق المصادقة.",
    totpEnable: "تفعيل 2FA",
    totpScan: "امسح بتطبيق المصادقة ثم أدخل الرمز الحالي من 6 أرقام:",
    totpConfirmBtn: "تحقق وفعّل",
    totpDisable: "تعطيل 2FA",
    stepUpTitle: "عملية حساسة — أكّد أنك أنت",
    stepUpBody:
      "هذه العملية قد تحوّل مدفوعات أو تدوّر أسراراً. أعد إدخال كلمة مرور الكونسول للمتابعة.",
    stepUpBtn: "تأكيد",
    sessionsTitle: "الجلسات الداخلة",
    sessionsNote: "كوكي HttpOnly · صلاحية متجددة · قابلة للإبطال",
    sessionRevoke: "إبطال",
    sessionRevokeAll: "أنهِ كل الجلسات الأخرى",
    sessionsEmpty: "لا جلسات أخرى نشطة.",
    sessionThisDevice: "هذا الجهاز",
    sessionMethodLink: "رابط استرجاع",
    sessionMethodKey: "مفتاح API",
    sessionMethodPassword: "كلمة مرور",
    sessionMethodFirstrun: "إعداد أول",
    claimFailed:
      "انتهت صلاحية رابط الاسترجاع أو استُخدم سابقاً. أنشئ رابطاً جديداً من الخادم: bun run console:link",
    claimOk: "دخلت عبر رابط الاسترجاع ✓ — ضع كلمة مرور أو تابع إلى الكونسول مباشرة.",
    lockedOut: "محاولات كثيرة — تم القفل. أعد المحاولة بعد {s} ثانية.",
    recoveryNote: "فقدت كلمة المرور؟ على الخادم نفّذ: bun run console:link ثم افتح الرابط المطبوع.",
    pwMismatch: "كلمتا المرور غير متطابقتين.",
    pwCurrent: "كلمة المرور الحالية",
    pwNew: "كلمة المرور الجديدة (10 أحرف فأكثر)",
    pwChangeBtn: "غيّر كلمة المرور",
    connectKeyMasked:
      "عُرض مرة واحدة عند الإعداد — العقدة تحفظ بصمته فقط. فقدت نسختك؟ «تدوير مفتاح API» بالأسفل ينشئ مفتاحاً جديداً.",
  },
} as const;

interface StatusPayload {
  configured: boolean;
}
interface SecEvent {
  id: string;
  type: string;
  severity: string;
  ip: string;
  userAgent: string;
  detail: string;
  createdAt: string;
}
interface SecurityData {
  encryption: Record<string, { status: string; detail: string }>;
  stats: { failed24h: number; throttled24h: number; blocked24h: number; total: number };
  events: SecEvent[];
}
interface ConsoleState {
  authenticated: boolean;
  method: string | null;
  stepUpFresh: boolean;
  passwordSet: boolean;
  totpEnabled: boolean;
}
interface SessionRow {
  id: string;
  method: string;
  ip: string;
  userAgent: string;
  trusted: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}
interface SystemStatus {
  store: { name: string; brandColor: string };
  wallet: { mode: string; confirmationsRequired: number; invoiceExpiryMinutes: number; lightning: string; lastAddress: string | null; derivations: number };
  counts: { invoices: number; paid: number };
  webhooks: { urls: string[]; secrets: string[] };
  recentInvoices: {
    id: string;
    orderId: string | null;
    amountSats: string;
    fiatAmountCents: number | null;
    fiatCurrency: string | null;
    status: string;
    createdAt: string;
  }[];
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

// ── shared bits (module scope — components must never be created during render) ──
function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-xl rounded-2xl border bg-card p-6 sm:p-8 shadow-lg">
      {children}
    </div>
  );
}

function Badge({ kind, t }: { kind: "req" | "opt" | "rec"; t: (typeof T)[Lang] }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        kind === "req"
          ? "border-orange-500/40 bg-orange-500/10 text-orange-600"
          : kind === "rec"
            ? "border-green-500/40 bg-green-500/10 text-green-600"
            : "border-muted-foreground/30 bg-muted text-muted-foreground"
      }`}
    >
      {kind === "req" ? t.badgeRequired : kind === "rec" ? t.badgeRecommended : t.badgeOptional}
    </span>
  );
}

export default function SetupWizard() {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("lang") === "ar") return "ar";
    return "en";
  });
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
  // merchant-journey state (wallet / connect / invoices)
  const [revealKey, setRevealKey] = useState(false);
  const [revealSecret, setRevealSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [hookList, setHookList] = useState<string[]>([]);
  const [newHook, setNewHook] = useState("");
  const [redriveMsg, setRedriveMsg] = useState("");
  // privacy / lightning / security state
  const [privacyMode, setPrivacyMode] = useState<"standard" | "balanced" | "maximum" | null>(null);
  const [lnUrl, setLnUrl] = useState("");
  const [lnPassword, setLnPassword] = useState("");
  const [lnConnected, setLnConnected] = useState<boolean | null>(null);
  const [lnMsg, setLnMsg] = useState<string | null>(null);
  const [sec, setSec] = useState<SecurityData | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  // ── console auth (v0.5.0): human credential + sessions + step-up ──
  const [authMethod, setAuthMethod] = useState<"session" | "key" | null>(null);
  const [consoleState, setConsoleState] = useState<ConsoleState | null>(null);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginTotp, setLoginTotp] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [bootstrapKey, setBootstrapKey] = useState("");
  const [firstRunStage, setFirstRunStage] = useState<null | "password" | "totp" | "done">(null);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [totpEnroll, setTotpEnroll] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPw, setStepUpPw] = useState("");
  const [stepUpTotp, setStepUpTotp] = useState("");
  const [stepUpErr, setStepUpErr] = useState<string | null>(null);
  const pendingActionRef = useRef<(() => Promise<void>) | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<null | "failed" | "ok">(null);
  const [pwChange, setPwChange] = useState({ current: "", next: "" });
  const [pwChangeOpen, setPwChangeOpen] = useState(false);

  function copyText(id: string, value: string) {
    void navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  }

  // Cookie-based console calls ride the session automatically; the explicit
  // Authorization header is only sent when a raw key is in memory (rotation flow).
  const authHeaders = useCallback((): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), [apiKey]);

  const loadManage = useCallback(async (): Promise<boolean> => {
    const r = await fetch("/api/system/status", { headers: authHeaders() });
    if (r.status === 401) {
      setError(t.errGeneric);
      return false;
    }
    const data = (await r.json()) as SystemStatus;
    setSys(data);
    setHookList(data.webhooks?.urls ?? []);
    const bl = await fetch("/api/system/backup", { headers: authHeaders() });
    const bd = await bl.json();
    setBackups(bd.backups ?? []);
    return true;
  }, [t, authHeaders]);

  // ── boot: session cookie first, login screen second ────────────────────────
  useEffect(() => {
    // Browser-only values (origin, query params) are read inside a microtask —
    // never setState synchronously in the effect body.
    queueMicrotask(() => {
      setBaseUrl(window.location.origin);
      const params = new URLSearchParams(window.location.search);
      if (params.get("claim") === "failed") setClaimMsg("failed");
      if (params.get("claimed")) setClaimMsg("ok");
    });
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then(async (s: StatusPayload) => {
        if (!s.configured) {
          setPhase("wizard");
          return;
        }
        try {
          const sr = await fetch("/api/console/session");
          const st = (await sr.json()) as ConsoleState;
          setConsoleState(st);
          if (st.authenticated) {
            setAuthMethod("session");
            if (!st.passwordSet) {
              // firstrun / recovery session — completing the credential is
              // MANDATORY before the console opens (no passwordless console).
              setFirstRunStage("password");
              setPhase("manage");
              return;
            }
            const ok = await loadManage();
            if (ok) {
              setPhase("manage");
              return;
            }
          }
        } catch {
          // console endpoints unreachable — fall through to the login screen
        }
        setPhase("manage");
      })
      .catch(() => setPhase("wizard"));
  }, []);

  // ── console login / bootstrap / first-run ──────────────────────────────────
  async function submitLogin() {
    setLoginBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/console/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword, totp: loginTotp || undefined, trustDevice }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; detail?: string; retryAfter?: number };
      if (r.ok) {
        setAuthMethod("session");
        setConsoleState((c) => (c ? { ...c, authenticated: true, method: "password" } : c));
        setLoginPassword("");
        setLoginTotp("");
        const ok = await loadManage();
        if (!ok) setError(t.errGeneric);
      } else if (d.error === "LOCKED" && d.retryAfter) {
        setError(t.lockedOut.replace("{s}", String(d.retryAfter)));
      } else {
        setError(d.detail ?? t.errGeneric);
      }
    } finally {
      setLoginBusy(false);
    }
  }

  async function submitBootstrap() {
    setLoginBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/console/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: bootstrapKey.trim() }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (r.ok) {
        setAuthMethod("session");
        setConsoleState({ authenticated: true, method: "firstrun", stepUpFresh: false, passwordSet: false, totpEnabled: false });
        setFirstRunStage("password");
        setBootstrapKey("");
      } else if (d.error === "LOCKED") {
        setError(d.detail ?? t.errGeneric);
      } else {
        setError(d.detail ?? t.errGeneric);
      }
    } finally {
      setLoginBusy(false);
    }
  }

  async function saveFirstRunPassword() {
    if (newPw !== newPw2) {
      setError(t.pwMismatch);
      return;
    }
    setLoginBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/console/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-password", password: newPw }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (r.ok) {
        setConsoleState((c) => (c ? { ...c, passwordSet: true } : c));
        setNewPw("");
        setNewPw2("");
        setFirstRunStage("totp");
      } else {
        setError(d.detail ?? t.errGeneric);
      }
    } finally {
      setLoginBusy(false);
    }
  }

  async function enrollTotp() {
    const r = await fetch("/api/console/credentials", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "totp-init" }),
    });
    if (r.status === 403) {
      setBusy(false);
      openStepUp(() => enrollTotp());
      return;
    }
    if (r.ok) setTotpEnroll((await r.json()) as { otpauthUri: string; secret: string });
  }

  async function confirmTotp(code: string) {
    const r = await fetch("/api/console/credentials", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "totp-confirm", code: code.trim() }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
    if (r.ok) {
      setTotpEnroll(null);
      setTotpCode("");
      setConsoleState((c) => (c ? { ...c, totpEnabled: true } : c));
      return true;
    }
    setError(d.detail ?? t.errGeneric);
    return false;
  }

  async function finishFirstRun() {
    setFirstRunStage(null);
    const ok = await loadManage();
    if (!ok) setError(t.errGeneric);
  }

  // ── step-up modal ──────────────────────────────────────────────────────────
  function openStepUp(action: () => Promise<void>) {
    pendingActionRef.current = action;
    setStepUpPw("");
    setStepUpTotp("");
    setStepUpErr(null);
    setStepUpOpen(true);
  }

  /** Routes 403 STEP_UP_REQUIRED into the password modal, then retries the action. */
  function guard(res: Response, action: () => Promise<void>): boolean {
    if (res.status === 403) {
      setBusy(false);
      openStepUp(action);
      return false;
    }
    return true;
  }

  async function submitStepUp() {
    setStepUpErr(null);
    const r = await fetch("/api/console/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: stepUpPw, totp: stepUpTotp || undefined }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string; detail?: string; retryAfter?: number };
    if (r.ok) {
      setStepUpOpen(false);
      setConsoleState((c) => (c ? { ...c, stepUpFresh: true } : c));
      const act = pendingActionRef.current;
      pendingActionRef.current = null;
      if (act) void act();
    } else if (d.error === "LOCKED" && d.retryAfter) {
      setStepUpErr(t.lockedOut.replace("{s}", String(d.retryAfter)));
    } else {
      setStepUpErr(d.detail ?? t.errGeneric);
    }
  }

  // ── session management ─────────────────────────────────────────────────────
  async function doLogout() {
    setBusy(true);
    await fetch("/api/console/logout", { method: "POST" });
    setSys(null);
    setApiKey("");
    setAuthMethod(null);
    setConsoleState(null);
    setSessions([]);
    setCurrentSessionId(null);
    setFirstRunStage(null);
    setBusy(false);
  }

  async function revokeSessionById(id: string) {
    setBusy(true);
    const r = await fetch("/api/console/sessions/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (r.ok) {
      const d = (await r.json()) as { self?: boolean };
      if (d.self) {
        await doLogout();
        setBusy(false);
        return;
      }
      await loadSessions();
    }
    setBusy(false);
  }

  async function revokeAllOtherSessions() {
    setBusy(true);
    await fetch("/api/console/sessions/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    await loadSessions();
    setBusy(false);
  }

  async function loadSessions() {
    try {
      const r = await fetch("/api/console/sessions", { headers: authHeaders() });
      if (r.ok) {
        const d = (await r.json()) as { currentId: string | null; sessions: SessionRow[] };
        setSessions(d.sessions ?? []);
        setCurrentSessionId(d.currentId ?? null);
      }
    } catch {
      // best effort
    }
  }

  // ── password change ────────────────────────────────────────────────────────
  async function submitPasswordChange() {
    if (pwChange.next !== pwChange.next.trim() || pwChange.next.length < 10) {
      setError(t.pwNew);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await fetch("/api/console/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-password", password: pwChange.next.trim(), currentPassword: pwChange.current }),
    });
    if (!guard(r, submitPasswordChange)) return;
    const d = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
    if (r.ok) {
      setPwChange({ current: "", next: "" });
      setPwChangeOpen(false);
      setConsoleState((c) => (c ? { ...c, stepUpFresh: true } : c));
    } else {
      setError(d.detail ?? t.errGeneric);
    }
    setBusy(false);
  }

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
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ pushRemote: push }),
    });
    await loadManage();
    setBusy(false);
  }

  async function download(name: string) {
    const r = await fetch(`/api/system/backup/${encodeURIComponent(name)}`, {
      headers: authHeaders(),
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
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!guard(r, () => restore(name))) return;
    const d = await r.json();
    setStagedHint(r.ok ? d?.staged?.nextStep ?? t.restoreHint : d?.error ?? t.errGeneric);
    setBusy(false);
  }

  async function restoreUpload(file: File) {
    setBusy(true);
    const r = await fetch("/api/system/backup/restore", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/octet-stream", "x-backup-name": file.name },
      body: await file.arrayBuffer(),
    });
    if (!guard(r, () => restoreUpload(file))) return;
    const d = await r.json();
    setStagedHint(r.ok ? d?.staged?.nextStep ?? t.restoreHint : d?.error ?? t.errGeneric);
    setBusy(false);
  }

  async function saveRemote() {
    setBusy(true);
    const r = await fetch("/api/system/backup/remote", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ remoteTarget: remote.trim(), remotePort: 22, passphrase: passphrase || undefined }),
    });
    if (!guard(r, saveRemote)) return;
    await loadManage();
    setBusy(false);
  }

  async function rotate() {
    setBusy(true);
    const r = await fetch("/api/setup/rotate-key", { method: "POST", headers: authHeaders() });
    if (!guard(r, rotate)) return;
    const d = await r.json();
    if (r.ok) {
      setNewKey(d.apiKey);
      setApiKey(d.apiKey);
    }
    setBusy(false);
  }

  async function saveHooks() {
    setBusy(true);
    const r = await fetch("/api/system/webhooks", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ urls: hookList }),
    });
    if (!guard(r, saveHooks)) return;
    await loadManage();
    setBusy(false);
  }

  async function redrive() {
    setBusy(true);
    setRedriveMsg("");
    const r = await fetch("/api/system/webhooks", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "redrive" }),
    });
    if (!guard(r, redrive)) return;
    if (r.ok) {
      const d = (await r.json()) as { redriven: number };
      setRedriveMsg(d.redriven > 0 ? `${d.redriven} ${t.hookRedriveDone}` : t.hookRedriveNone);
    } else {
      setRedriveMsg(t.hookRedriveFail);
    }
    setBusy(false);
  }

  // ── privacy / lightning / security / sessions ───────────────────────────────
  const loadSecurity = useCallback(async () => {
    try {
      const [sr, lr, pr] = await Promise.all([
        fetch("/api/system/security", { headers: authHeaders() }),
        fetch("/api/system/lightning", { headers: authHeaders() }),
        fetch("/api/system/privacy", { headers: authHeaders() }),
      ]);
      if (sr.ok) setSec((await sr.json()) as SecurityData);
      if (lr.ok) {
        const d = (await lr.json()) as { url: string | null; connected: boolean };
        setLnConnected(d.connected);
        setLnUrl(d.url ?? "");
      }
      if (pr.ok) {
        const d = (await pr.json()) as { mode: "standard" | "balanced" | "maximum" };
        setPrivacyMode(d.mode);
      }
    } catch {
      // monitor is best-effort
    }
    await loadSessions();
  }, [authHeaders]);

  useEffect(() => {
    if (!sys) return;
    queueMicrotask(() => void loadSecurity());
    const iv = setInterval(() => void loadSecurity(), 15_000);
    return () => clearInterval(iv);
  }, [sys, loadSecurity]);

  async function savePrivacy(mode: "standard" | "balanced" | "maximum") {
    setBusy(true);
    await fetch("/api/system/privacy", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    setPrivacyMode(mode);
    setBusy(false);
  }

  async function connectLightning() {
    setBusy(true);
    setLnMsg(null);
    const r = await fetch("/api/system/lightning", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ url: lnUrl.trim(), password: lnPassword }),
    });
    if (!guard(r, connectLightning)) return;
    const d = await r.json();
    if (r.ok) {
      setLnConnected(true);
      setLnPassword("");
      setLnMsg(`${t.lnConnected}${d?.node?.version ? ` (${d.node.version})` : ""}`);
    } else {
      setLnMsg(`${d?.error ?? "ERROR"}${d?.detail ? ` — ${d.detail}` : ""}`);
    }
    setBusy(false);
  }

  async function disconnectLightning() {
    setBusy(true);
    const r = await fetch("/api/system/lightning", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ url: "-", password: "-", clear: true }),
    });
    if (!guard(r, disconnectLightning)) return;
    setLnConnected(false);
    setLnUrl("");
    setLnMsg(null);
    setBusy(false);
  }

  async function encryptNow() {
    setBusy(true);
    const r = await fetch("/api/system/security", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "encrypt-secrets" }),
    });
    if (!guard(r, encryptNow)) return;
    await loadSecurity();
    setBusy(false);
  }

  async function purgeLog() {
    setBusy(true);
    const r = await fetch("/api/system/security", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "purge-log" }),
    });
    if (!guard(r, purgeLog)) return;
    await loadSecurity();
    setBusy(false);
  }

  // ── shared bits ───────────────────────────────────────────────────────────
  const statusPill = (s: string) =>
    s === "settled" || s === "confirmed"
      ? "border-green-500/30 bg-green-500/10 text-green-600"
      : s === "detected"
        ? "border-blue-500/30 bg-blue-500/10 text-blue-600"
        : s === "expired"
          ? "border-red-500/30 bg-red-500/10 text-red-600"
          : s === "underpaid"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
            : "border-border bg-muted text-muted-foreground";
  const secEventColor = (sev: string) =>
    sev === "critical"
      ? "border-purple-500/40 bg-purple-500/10 text-purple-500"
      : sev === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
        : sev === "ok"
          ? "border-green-500/40 bg-green-500/10 text-green-600"
          : "border-border bg-muted text-muted-foreground";
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
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                onClick={() => setLang(lang === "en" ? "ar" : "en")}
              >
                {lang === "en" ? "العربية" : "English"}
              </button>
              <button
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                onClick={doLogout}
              >
                {sys ? `🔒 ${t.logout}` : ""}
              </button>
            </div>
          </div>

          {!sys ? (
            <Card>
              <h1 className="text-xl font-bold mb-3">
                {firstRunStage ? t.firstRunTitle : t.loginTitle}
              </h1>

              {claimMsg && (
                <p
                  className={`mb-4 rounded-md border px-3 py-2 text-xs ${
                    claimMsg === "ok"
                      ? "border-green-500/40 bg-green-500/10 text-green-600"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-600"
                  }`}
                >
                  {claimMsg === "ok" ? `✓ ${t.claimOk}` : `⚠ ${t.claimFailed}`}
                </p>
              )}

              {/* ── FIRST RUN: create the console password ───────────── */}
              {firstRunStage === "password" && (
                <>
                  <p className="text-sm text-muted-foreground mb-4">{t.firstRunBody}</p>
                  <span className={label}>{t.firstRunPw}</span>
                  <input dir="ltr" type="password" className={input} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                  <span className={`${label} mt-3`}>{t.firstRunPw2}</span>
                  <input dir="ltr" type="password" className={input} value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
                  <button
                    className="mt-4 w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:opacity-90"
                    onClick={saveFirstRunPassword}
                    disabled={loginBusy || newPw.length < 10 || newPw !== newPw2}
                  >
                    {t.firstRunSave} →
                  </button>
                  {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
                </>
              )}

              {/* ── FIRST RUN: optional 2FA enrollment ────────────────── */}
              {firstRunStage === "totp" && (
                <>
                  <p className="text-sm text-muted-foreground mb-3">✓ {t.firstRunDone}</p>
                  <h2 className="font-semibold text-sm mb-2">{t.firstRunTotpTitle}</h2>
                  {!totpEnroll ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                        onClick={enrollTotp}
                      >
                        {t.totpEnable}
                      </button>
                      <button className="rounded-md border px-4 py-2 text-sm hover:bg-muted" onClick={finishFirstRun}>
                        {t.firstRunTotpSkip}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground mb-3">{t.firstRunTotpScan}</p>
                      <div className="mb-3 flex justify-center rounded-lg border bg-white p-3">
                        <QRCodeSVG value={totpEnroll.otpauthUri} size={160} />
                      </div>
                      <code dir="ltr" className="mb-3 block rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
                        {totpEnroll.secret}
                      </code>
                      <input
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={6}
                        className={`${input} font-mono tracking-widest`}
                        placeholder="123456"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                          disabled={totpCode.length !== 6 || loginBusy}
                          onClick={async () => {
                            if (await confirmTotp(totpCode)) void finishFirstRun();
                          }}
                        >
                          {t.totpConfirmBtn}
                        </button>
                        <button className="rounded-md border px-4 py-2 text-sm hover:bg-muted" onClick={finishFirstRun}>
                          {t.firstRunTotpSkip}
                        </button>
                      </div>
                    </>
                  )}
                  {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
                </>
              )}

              {/* ── BOOTSTRAP: no password yet — API key proves ownership once */}
              {!firstRunStage && consoleState && !consoleState.passwordSet && (
                <>
                  <p className="text-sm text-muted-foreground mb-4">{t.firstRunBody}</p>
                  <span className={label}>{t.firstRunKey}</span>
                  <input
                    dir="ltr"
                    type="password"
                    className={`${input} font-mono`}
                    placeholder="lp_live_…"
                    value={bootstrapKey}
                    onChange={(e) => setBootstrapKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && bootstrapKey.trim()) void submitBootstrap(); }}
                  />
                  <button
                    className="mt-4 w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:opacity-90"
                    onClick={submitBootstrap}
                    disabled={loginBusy || !bootstrapKey.trim()}
                  >
                    {t.firstRunTitle} →
                  </button>
                  {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
                </>
              )}

              {/* ── DAILY LOGIN: password (+ TOTP when enabled) ───────── */}
              {!firstRunStage && consoleState?.passwordSet && (
                <>
                  <p className="text-sm text-muted-foreground mb-4">{t.loginBody}</p>
                  <span className={label}>{t.loginPassword}</span>
                  <input
                    dir="ltr"
                    type="password"
                    className={input}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && loginPassword) void submitLogin(); }}
                  />
                  {consoleState.totpEnabled && (
                    <>
                      <span className={`${label} mt-3`}>{t.loginTotp}</span>
                      <input
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={6}
                        className={`${input} font-mono tracking-widest`}
                        placeholder="123456"
                        value={loginTotp}
                        onChange={(e) => setLoginTotp(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={(e) => { if (e.key === "Enter" && loginPassword) void submitLogin(); }}
                      />
                    </>
                  )}
                  <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
                    {t.trustDevice}
                  </label>
                  <button
                    className="mt-4 w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:opacity-90"
                    onClick={submitLogin}
                    disabled={loginBusy || !loginPassword}
                  >
                    {t.loginBtn} →
                  </button>
                  {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
                  <p className="mt-4 text-xs text-muted-foreground" dir="ltr">
                    <code>{t.recoveryNote}</code>
                  </p>
                </>
              )}
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

              {/* ── PRIVACY MODE ───────────────────────────────────────── */}
              <Card>
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-lg font-bold">🛡️ {t.privacyTitle}</h2>
                  <Badge kind="rec" t={t} />
                </div>
                <p className="text-sm text-muted-foreground mb-4">{t.privacyIntro}</p>
                <div className="space-y-2">
                  {([
                    ["maximum", t.privacyMaximum, t.privacyMaximumDesc],
                    ["balanced", t.privacyBalanced, t.privacyBalancedDesc],
                    ["standard", t.privacyStandard, t.privacyStandardDesc],
                  ] as const).map(([mode, title, desc]) => (
                    <button
                      key={mode}
                      disabled={busy}
                      onClick={() => void savePrivacy(mode)}
                      className={`w-full rounded-lg border p-3 text-start transition-colors ${
                        privacyMode === mode
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{title}</span>
                        {privacyMode === mode && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">{t.privacyNow}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
                    </button>
                  ))}
                </div>
              </Card>

              {/* ── WALLET ─────────────────────────────────────────────── */}
              <Card>
                <h2 className="text-lg font-bold mb-2">👛 {t.walletTitle}</h2>
                <p className="text-sm text-muted-foreground mb-3">{t.walletExplain}</p>
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">{t.walletMode}</div>
                    <div className="font-semibold">{sys.wallet.mode === "watchonly" ? t.modeWatchonly : sys.wallet.mode === "selfcustody" ? t.modeSelfcustody : t.modeNone}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">{t.walletDerivations}</div>
                    <div className="font-semibold">{sys.wallet.derivations}</div>
                  </div>
                </div>
                {sys.wallet.lastAddress && (
                  <div className="mb-4">
                    <span className={label}>{t.walletLastAddr}</span>
                    <div className="flex gap-2">
                      <code dir="ltr" className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">{sys.wallet.lastAddress}</code>
                      <button className="rounded-md border px-3 text-xs hover:bg-muted shrink-0" onClick={() => copyText("addr", sys.wallet.lastAddress ?? "")}>{copied === "addr" ? t.copied : t.copy}</button>
                    </div>
                  </div>
                )}
                {sys.wallet.mode === "watchonly" && <p className="text-xs text-muted-foreground mb-2">{t.walletZpubHelp}</p>}
                <p className="text-xs text-muted-foreground">
                  {t.walletCold}{" "}
                  <Link href={`/cold?lang=${lang}`} className="font-medium text-primary underline underline-offset-2">{t.coldTool}</Link>
                </p>
              </Card>

              {/* ── CONNECT YOUR STORE ─────────────────────────────────── */}
              <Card>
                <h2 className="text-lg font-bold mb-1">🔗 {t.connectTitle}</h2>
                <p className="text-sm text-muted-foreground mb-4">{t.connectIntro}</p>

                <span className={label}>{t.connectBase}</span>
                <div className="flex gap-2 mb-4">
                  <code dir="ltr" className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">{baseUrl}</code>
                  <button className="rounded-md border px-3 text-xs hover:bg-muted shrink-0" onClick={() => copyText("base", baseUrl)}>{copied === "base" ? t.copied : t.copy}</button>
                </div>

                <span className={label}>{t.connectKey}</span>
                <div className="flex gap-2 mb-1">
                  <code dir="ltr" className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
                    {apiKey ? (revealKey ? apiKey : `${apiKey.slice(0, 12)}…${apiKey.slice(-4)}`) : "lp_live_••••••••••••••••••••"}
                  </code>
                  {apiKey && (
                    <button className="rounded-md border px-3 text-xs hover:bg-muted shrink-0" onClick={() => setRevealKey((v) => !v)}>{revealKey ? t.hide : t.reveal}</button>
                  )}
                  {apiKey && (
                    <button className="rounded-md border px-3 text-xs hover:bg-muted shrink-0" onClick={() => copyText("key", apiKey)}>{copied === "key" ? t.copied : t.copy}</button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-4">{apiKey ? t.connectKeyNote : t.connectKeyMasked}</p>

                {sys.webhooks.secrets.length > 0 && (
                  <>
                    <span className={label}>{t.connectHook}</span>
                    <div className="flex gap-2 mb-1">
                      <code dir="ltr" className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
                        {revealSecret ? sys.webhooks.secrets[0] : `${sys.webhooks.secrets[0].slice(0, 8)}••••••••`}
                      </code>
                      <button className="rounded-md border px-3 text-xs hover:bg-muted shrink-0" onClick={() => setRevealSecret((v) => !v)}>{revealSecret ? t.hide : t.reveal}</button>
                      <button className="rounded-md border px-3 text-xs hover:bg-muted shrink-0" onClick={() => copyText("hook", sys.webhooks.secrets[0])}>{copied === "hook" ? t.copied : t.copy}</button>
                    </div>
                    <p className="text-xs text-muted-foreground mb-4">{t.connectHookNote}</p>
                  </>
                )}

                <span className={label}>{t.hookUrls}</span>
                {hookList.length === 0 && <p className="text-xs text-muted-foreground mb-2">{t.hookEmpty}</p>}
                <ul className="space-y-1.5 mb-2">
                  {hookList.map((u) => (
                    <li key={u} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                      <span dir="ltr" className="truncate font-mono text-xs">{u}</span>
                      <button className="rounded border px-2 py-0.5 text-xs hover:bg-muted shrink-0" disabled={busy} onClick={() => setHookList(hookList.filter((x) => x !== u))}>✕</button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 mb-2">
                  <input
                    dir="ltr"
                    className={`${input} font-mono text-xs`}
                    placeholder={t.hookAdd}
                    value={newHook}
                    onChange={(e) => setNewHook(e.target.value)}
                  />
                  <button
                    className="rounded-md border px-3 text-sm hover:bg-muted shrink-0"
                    disabled={busy || !newHook.trim()}
                    onClick={() => { setHookList([...hookList, newHook.trim()]); setNewHook(""); }}
                  >+</button>
                </div>
                <div className="flex items-center gap-2 mb-5">
                  <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" disabled={busy} onClick={saveHooks}>{t.hookSave}</button>
                  <button
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                    disabled={busy}
                    onClick={redrive}
                  >{t.hookRedrive}</button>
                  {redriveMsg && <span className="text-xs text-muted-foreground">{redriveMsg}</span>}
                </div>

                <div className="rounded-lg border p-4 mb-4">
                  <h3 className="font-semibold text-sm mb-2">🛒 {t.wooTitle}</h3>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>{t.wooStep1}</li>
                    <li>{t.wooStep2}</li>
                    <li>{t.wooStep3}</li>
                    <li>{t.wooStep4}</li>
                    <li>{t.wooStep5}</li>
                  </ol>
                  <a
                    href="/downloads/librepay-woocommerce.zip"
                    download
                    className="mt-3 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                  >
                    {t.downloadPlugin}
                  </a>
                </div>

                <span className={label}>{t.curlTitle}</span>
                <pre dir="ltr" className="overflow-x-auto whitespace-pre rounded-md border bg-muted px-3 py-2 text-xs font-mono">{`curl -X POST ${baseUrl}/api/v1/invoices \\
  -H "Authorization: Bearer ${revealKey && apiKey ? apiKey : "lp_live_YOUR_KEY"}" \\
  -H "Content-Type: application/json" \\
  -d '{"amountFiat": 9.99, "currency": "USD", "orderId": "order-123"}'`}</pre>
              </Card>

              {/* ── LIGHTNING (OPTIONAL) ───────────────────────────────── */}
              <Card>
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-lg font-bold">⚡ {t.lnTitle}</h2>
                  <Badge kind="opt" t={t} />
                </div>
                <p className="text-sm text-muted-foreground mb-3">{t.lnIntro}</p>
                <div className="mb-4 flex items-center gap-2 text-sm">
                  {lnConnected ? (
                    <span className="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-600">✓ {t.lnConnected}</span>
                  ) : (
                    <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">{t.lnDisconnected}</span>
                  )}
                  {lnConnected && (
                    <button className="rounded border px-2 py-1 text-xs hover:bg-muted" disabled={busy} onClick={disconnectLightning}>
                      {t.lnDisconnect}
                    </button>
                  )}
                </div>
                {privacyMode !== "maximum" && (
                  <>
                    <span className={label}>{t.lnUrl}</span>
                    <input dir="ltr" className={`${input} mb-3 font-mono text-xs`} placeholder="https://phoenixd.example.com:9740" value={lnUrl} onChange={(e) => setLnUrl(e.target.value)} />
                    <span className={label}>{t.lnPassword}</span>
                    <input dir="ltr" type="password" className={`${input} mb-3 font-mono text-xs`} placeholder="••••••••" value={lnPassword} onChange={(e) => setLnPassword(e.target.value)} />
                    <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90" disabled={busy || !lnUrl.trim() || !lnPassword} onClick={connectLightning}>
                      {t.lnConnect}
                    </button>
                    {lnMsg && <p className="mt-2 text-xs text-muted-foreground">{lnMsg}</p>}
                    <p className="mt-3 text-xs text-muted-foreground">{t.lnNote}</p>
                  </>
                )}
              </Card>

              {/* ── RECENT INVOICES ────────────────────────────────────── */}
              <Card>
                <h2 className="text-lg font-bold mb-3">🧾 {t.invoicesTitle}</h2>
                {sys.recentInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.invoicesEmpty}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {sys.recentInvoices.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{inv.orderId || inv.id}</div>
                          <div className="text-xs text-muted-foreground">{new Date(inv.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div dir="ltr" className="font-mono text-xs font-semibold">
                            {inv.amountSats} sats{inv.fiatAmountCents ? ` · $${(inv.fiatAmountCents / 100).toFixed(2)}` : ""}
                          </div>
                          <div className="mt-0.5 flex items-center justify-end gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(inv.status)}`}>{inv.status}</span>
                            <a href={`/pay/${inv.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline underline-offset-2">{t.openCheckout}</a>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* ── SECURITY & MONITORING ──────────────────────────────── */}
              <Card>
                <h2 className="text-lg font-bold mb-3">🔐 {t.secTitle}</h2>

                {sec && sec.stats.failed24h >= 5 && (
                  <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">⚠ {t.secAlert}</p>
                )}

                {/* ── CONSOLE SESSIONS (who else is inside?) ─────────────── */}
                <div className="mb-1 flex items-center justify-between">
                  <span className={label}>{t.sessionsTitle}</span>
                  <button
                    className="rounded border px-2 py-0.5 text-[10px] hover:bg-muted"
                    disabled={busy || sessions.length <= 1}
                    onClick={revokeAllOtherSessions}
                  >
                    {t.sessionRevokeAll}
                  </button>
                </div>
                <p className="mb-2 text-[10px] text-muted-foreground">{t.sessionsNote}</p>
                <ul className="mb-5 space-y-1">
                  {sessions.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium">
                          {s.method === "link" ? t.sessionMethodLink : s.method === "key" ? t.sessionMethodKey : s.method === "firstrun" ? t.sessionMethodFirstrun : t.sessionMethodPassword}
                        </span>
                        {s.id === currentSessionId && (
                          <span className="ms-2 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-600">{t.sessionThisDevice}</span>
                        )}
                        <span className="ms-2 text-muted-foreground">{s.ip} · {new Date(s.lastSeenAt).toLocaleString()}</span>
                      </div>
                      {s.id !== currentSessionId && (
                        <button className="shrink-0 rounded border px-2 py-0.5 text-[10px] hover:bg-muted" disabled={busy} onClick={() => revokeSessionById(s.id)}>
                          {t.sessionRevoke}
                        </button>
                      )}
                    </li>
                  ))}
                  {sessions.length === 0 && (
                    <li className="rounded-md border px-3 py-2 text-xs text-muted-foreground">{t.sessionsEmpty}</li>
                  )}
                </ul>

                {/* ── 2FA (TOTP) ─────────────────────────────────────────── */}
                <div className="mb-1 flex items-center justify-between">
                  <span className={label}>{t.totpCard}</span>
                  {consoleState?.totpEnabled ? (
                    <span className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-600">✓ ON</span>
                  ) : (
                    <button
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      disabled={busy || !consoleState?.passwordSet}
                      onClick={() => (consoleState?.stepUpFresh ? enrollTotp() : openStepUp(enrollTotp))}
                    >
                      {t.totpEnable}
                    </button>
                  )}
                </div>
                {consoleState?.totpEnabled && <p className="mb-3 text-xs text-muted-foreground">{t.totpOn}</p>}
                {totpEnroll && !consoleState?.totpEnabled && (
                  <div className="mb-4 rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground mb-2">{t.totpScan}</p>
                    <div className="mb-2 flex justify-center rounded-lg border bg-white p-3">
                      <QRCodeSVG value={totpEnroll.otpauthUri} size={140} />
                    </div>
                    <code dir="ltr" className="mb-2 block rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
                      {totpEnroll.secret}
                    </code>
                    <input
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={6}
                      className={`${input} mb-2 font-mono tracking-widest`}
                      placeholder="123456"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                    />
                    <button
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      disabled={totpCode.length !== 6 || busy}
                      onClick={async () => {
                        if (await confirmTotp(totpCode)) setTotpEnroll(null);
                      }}
                    >
                      {t.totpConfirmBtn}
                    </button>
                  </div>
                )}

                {/* ── PASSWORD CHANGE ────────────────────────────────────── */}
                <div className="mb-1 flex items-center justify-between">
                  <span className={label}>🔑 {t.pwChangeBtn}</span>
                  <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" disabled={busy} onClick={() => setPwChangeOpen((v) => !v)}>
                    {pwChangeOpen ? "▴" : "▾"}
                  </button>
                </div>
                {pwChangeOpen && (
                  <div className="mb-4">
                    <input dir="ltr" type="password" className={`${input} mb-2`} placeholder={t.pwCurrent} value={pwChange.current} onChange={(e) => setPwChange({ ...pwChange, current: e.target.value })} />
                    <input dir="ltr" type="password" className={`${input} mb-2`} placeholder={t.pwNew} value={pwChange.next} onChange={(e) => setPwChange({ ...pwChange, next: e.target.value })} />
                    <button
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      disabled={busy || !pwChange.current || pwChange.next.length < 10}
                      onClick={submitPasswordChange}
                    >
                      {t.pwChangeBtn}
                    </button>
                  </div>
                )}

                <div className="mb-2 flex items-center justify-between">
                  <span className={label}>{t.secEnc}</span>
                  {sec && (sec.encryption.phoenixdPassword.status === "plaintext" || sec.encryption.backupPassphrase.status === "plaintext") && (
                    <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90" disabled={busy} onClick={encryptNow}>
                      {t.secEncryptNow}
                    </button>
                  )}
                </div>
                {sec && (
                  <ul className="mb-4 space-y-1.5">
                    {Object.entries(sec.encryption).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                        <span className="font-medium">{k}</span>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-xs text-muted-foreground" title={v.detail}>{v.detail}</span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${secEventColor(v.status === "plaintext" ? "warn" : v.status === "encrypted" || v.status === "hash-only" ? "ok" : "info")}`}>
                            {v.status}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mb-2 flex items-center justify-between">
                  <span className={label}>{t.secMonitor}</span>
                  <span className="text-[10px] text-muted-foreground">{t.secAuto}</span>
                </div>
                {sec && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    {t.secEvents24} {sec.stats.failed24h} {t.secFailed} · {sec.stats.throttled24h} {t.secThrottled} · {sec.stats.blocked24h} {t.secBlocked}
                    <button className="ms-3 rounded border px-2 py-0.5 text-[10px] hover:bg-muted" disabled={busy} onClick={purgeLog}>{t.secPurge}</button>
                  </p>
                )}
                <ul className="mb-4 max-h-72 space-y-1 overflow-y-auto">
                  {(sec?.events ?? []).map((ev) => (
                    <li key={ev.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-1.5 text-xs">
                      <div className="min-w-0">
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${secEventColor(ev.severity)}`}>{ev.type}</span>
                        <span className="ms-2 text-muted-foreground">{ev.detail}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground" title={ev.userAgent}>
                        {ev.ip} · {new Date(ev.createdAt).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                  {sec && sec.events.length === 0 && (
                    <li className="rounded-md border px-3 py-2 text-xs text-muted-foreground">—</li>
                  )}
                </ul>

                <button className="text-xs text-primary underline underline-offset-2" onClick={() => setShowChecklist((v) => !v)}>
                  {t.secChecklist} {showChecklist ? "▴" : "▾"}
                </button>
                {showChecklist && (
                  <ul className="mt-2 space-y-1 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground" dir="ltr">
                    <li><code>chmod 600 .env data/config.json</code> — secrets readable by the node user only</li>
                    <li><code>ufw default deny + allow 22,443/tcp</code> — only SSH & HTTPS reach this box</li>
                    <li><code>apt install fail2ban</code> — bans brute-force IPs at the firewall</li>
                    <li>SSH keys only: <code>PasswordAuthentication no</code></li>
                    <li>Keep phoenixd bound to 127.0.0.1 — never expose its port</li>
                  </ul>
                )}
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
              {/* ── STEP-UP MODAL (sensitive actions re-ask the password) ── */}
              {stepUpOpen && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setStepUpOpen(false)}>
                  <div
                    className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 className="mb-1 text-lg font-bold">🛡️ {t.stepUpTitle}</h3>
                    <p className="mb-4 text-sm text-muted-foreground">{t.stepUpBody}</p>
                    <input
                      dir="ltr"
                      type="password"
                      autoFocus
                      className={`${input} mb-2`}
                      placeholder={t.loginPassword}
                      value={stepUpPw}
                      onChange={(e) => setStepUpPw(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && stepUpPw) void submitStepUp(); }}
                    />
                    {consoleState?.totpEnabled && (
                      <input
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={6}
                        className={`${input} mb-2 font-mono tracking-widest`}
                        placeholder="123456"
                        value={stepUpTotp}
                        onChange={(e) => setStepUpTotp(e.target.value.replace(/\D/g, ""))}
                      />
                    )}
                    {stepUpErr && <p className="mb-2 text-sm text-destructive">{stepUpErr}</p>}
                    <div className="flex gap-2">
                      <button
                        className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                        disabled={!stepUpPw}
                        onClick={submitStepUp}
                      >
                        {t.stepUpBtn}
                      </button>
                      <button className="rounded-md border px-4 py-2 text-sm hover:bg-muted" onClick={() => setStepUpOpen(false)}>
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
            <div className="mb-1 flex items-center gap-2">
              <h1 className="text-xl font-bold mb-4">🏪 {t.store}</h1>
              <Badge kind="req" t={t} />
            </div>
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
            <div className="mb-1 flex items-center gap-2">
              <h1 className="text-xl font-bold mb-1">👛 {t.wallet}</h1>
              <Badge kind="req" t={t} />
            </div>
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
              placeholder={walletKind === "zpub" ? "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs" : "6bv5nPhrTBXZ…"}
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
            <div className="mb-1 flex items-center gap-2">
              <h1 className="text-xl font-bold mb-4">⏱ {t.policy}</h1>
              <Badge kind="rec" t={t} />
            </div>
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
