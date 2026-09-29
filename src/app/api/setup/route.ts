/**
 * POST /api/setup — the first-run Setup Wizard endpoint (and the operator
 * console for later changes).
 *
 * Two authorization regimes, by design:
 *   - node NOT configured yet → body.setupToken must match data/SETUP_TOKEN
 *     (proof of server access). The token is consumed on success and the
 *     window closes forever.
 *   - node configured → standard Bearer lp_live_ API key required.
 *
 * Principles preserved: no accounts (one config file), keys stay off the
 * server (watch-only zpub / payment code validated by deriving a real
 * address as proof), the raw API key is returned exactly once and only its
 * sha256 is stored.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey, generateApiKey } from "@/lib/server/api-auth";
import { deriveInvoiceAddress, deriveWatchOnlyAddress } from "@/lib/server/derive";
import { hrpFor } from "@/lib/network";
import { env } from "@/lib/env";
import {
  consumeSetupToken,
  getSettings,
  isConfigured,
  saveSettings,
  verifySetupToken,
} from "@/lib/server/settings";
import { getBaseUrl } from "@/lib/config";
import { encryptServerSecret } from "@/lib/server/crypto-server";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

function hex(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

const bodySchema = z.object({
  setupToken: z.string().max(64).optional(),
  storeName: z.string().trim().min(1).max(60),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f7931a"),
  wallet: z.object({
    kind: z.enum(["zpub", "xpub", "paymentcode"]),
    value: z.string().trim().min(20).max(120),
  }),
  confirmationsRequired: z.number().int().min(1).max(6).default(2),
  invoiceExpiryMinutes: z.number().int().min(5).max(120).default(15),
  baseUrl: z.string().max(200).default(""),
  webhookUrl: z.string().max(300).optional(),
  lightning: z
    .object({
      url: z.string().max(200).optional(),
      password: z.string().max(200).optional(),
    })
    .optional(),
  backup: z
    .object({
      enabled: z.boolean().default(true),
      intervalHours: z.number().int().min(1).max(168).default(24),
      retain: z.number().int().min(3).max(120).default(14),
      remoteTarget: z.string().max(200).default(""),
      remotePort: z.number().int().min(1).max(65535).default(22),
      passphrase: z.string().min(8).max(200).or(z.literal("")).default(""),
    })
    .optional(),
});

export async function POST(req: Request) {
  const configured = isConfigured();
  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  if (configured) {
    // operator console mode — API key required
    const authReq = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: rawText,
    });
    const auth = await authenticateApiKey(authReq);
    if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  } else {
    // first-run mode — setup token required (proof of server access)
    let probe: { setupToken?: string };
    try {
      probe = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
    }
    const token = probe?.setupToken ?? "";
    if (!token || !verifySetupToken(token)) {
      return NextResponse.json({ error: "SETUP_TOKEN_REQUIRED" }, { status: 401 });
    }
  }

  const body = bodySchema.safeParse(JSON.parse(rawText));
  if (!body.success) {
    return NextResponse.json({ error: "VALIDATION", issues: body.error.issues.slice(0, 5) }, { status: 400 });
  }
  const b = body.data;

  // ── wallet validation = derive a REAL address as proof the node sees it ──
  const hrp = hrpFor(env.NETWORK);
  let proofAddress: string;
  let paymentCode: string | null = null;
  let xpub: string | null = null;
  try {
    if (b.wallet.kind === "paymentcode") {
      const d = deriveInvoiceAddress(b.wallet.value, hrp);
      proofAddress = d.address;
      paymentCode = b.wallet.value;
    } else {
      const d = deriveWatchOnlyAddress(b.wallet.value, 0, hrp);
      proofAddress = d.address;
      xpub = b.wallet.value;
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: "WALLET_REJECTED",
        detail: e instanceof Error ? e.message : "derivation failed",
        hint:
          b.wallet.kind === "paymentcode"
            ? "a LibrePay payment code is 103 characters and starts with 6bv5 (from your wallet derivation or scripts/setup.ts)"
            : hrp === "tb"
              ? "on this testnet node paste a vpub (BIP84 testnet, from a testnet wallet) — zpub/xpub are mainnet keys"
              : "a BIP84 zpub starts with zpub (or xpub) — check for typos and that it is the account-level key",
      },
      { status: 422 }
    );
  }

  // ── persist settings ──
  const prev = getSettings();
  const firstSetup = !configured;
  const key = firstSetup || !prev.apiKeyHash ? generateApiKey() : null;
  const webhookSecret =
    b.webhookUrl && b.webhookUrl !== (prev.webhookUrls[0] ?? "") ? hex(32) : prev.webhookSecrets[0] ?? hex(32);

  saveSettings({
    setupComplete: true,
    storeName: b.storeName,
    brandColor: b.brandColor,
    paymentCode,
    xpub,
    confirmationsRequired: b.confirmationsRequired,
    invoiceExpiryMinutes: b.invoiceExpiryMinutes,
    baseUrl: b.baseUrl.replace(/\/+$/, ""),
    apiKeyHash: key ? key.hash : prev.apiKeyHash,
    webhookUrls: b.webhookUrl ? [b.webhookUrl] : prev.webhookUrls,
    webhookSecrets: b.webhookUrl ? [webhookSecret] : prev.webhookSecrets,
    lightning: b.lightning?.url
      ? {
          url: b.lightning.url,
          password: "",
          passwordEnc: b.lightning.password ? encryptServerSecret(b.lightning.password) : null,
        }
      : prev.lightning,
    backup: b.backup
      ? {
          enabled: b.backup.enabled,
          intervalHours: b.backup.intervalHours,
          retain: b.backup.retain,
          remoteTarget: b.backup.remoteTarget,
          remotePort: b.backup.remotePort,
          passphrase: "",
          passphraseEnc: b.backup.passphrase ? encryptServerSecret(b.backup.passphrase) : prev.backup.passphraseEnc,
        }
      : prev.backup,
  });

  logSecurityEvent({
    type: SecurityEventType.SETUP_COMPLETED,
    severity: "critical",
    req,
    detail: firstSetup ? "first setup completed — node is live" : "setup re-run (config overwritten)",
  });

  if (firstSetup) consumeSetupToken();

  const s = getSettings();
  const base = s.baseUrl || getBaseUrl() || "";
  return NextResponse.json(
    {
      ok: true,
      firstSetup,
      proofAddress,
      apiKey: key?.raw ?? null, // shown ONCE — only its sha256 is stored
      webhookSecret: b.webhookUrl ? webhookSecret : null,
      checkoutBase: base || "(request origin)",
      walletMode: paymentCode ? "selfcustody" : "watchonly",
    },
    { status: 201 }
  );
}
