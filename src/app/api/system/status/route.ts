/**
 * GET /api/system/status — operator dashboard payload (Bearer required).
 *
 * The console is key-gated: whoever holds the API key IS the operator, so
 * this payload includes everything the operator needs to connect a store —
 * wallet state, webhook config, and the last invoices. The API key itself is
 * NEVER returned (only its sha256 is stored server-side).
 */

import { NextResponse } from "next/server";
import { authenticateConsole } from "@/lib/server/console-auth";
import { getMerchant } from "@/lib/config";
import { getSettings } from "@/lib/server/settings";
import { backupStatus, listBackups } from "@/lib/server/backup";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateConsole(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const me = getMerchant();
  const s = getSettings();
  let counts = { invoices: 0, paid: 0 };
  let walletLastAddress: string | null = null;
  let walletDerivations = 0;
  let recentInvoices: {
    id: string;
    orderId: string | null;
    amountSats: string;
    fiatAmountCents: number | null;
    fiatCurrency: string | null;
    status: string;
    createdAt: string;
  }[] = [];
  try {
    const [{ db: client }] = await Promise.all([import("@/lib/db")]);
    counts.invoices = await client.invoice.count();
    counts.paid = await client.invoice.count({
      where: { status: { in: ["confirmed", "settled"] } },
    });
    const last = await client.invoice.findFirst({
      orderBy: { createdAt: "desc" },
      select: { stealthAddress: true, derivationIndex: true },
    });
    if (last) {
      walletLastAddress = last.stealthAddress;
      walletDerivations = (last.derivationIndex ?? 0) + 1;
    }
    const rows = await client.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderId: true,
        amountSats: true,
        fiatAmountCents: true,
        fiatCurrency: true,
        status: true,
        createdAt: true,
      },
    });
    recentInvoices = rows.map((r) => ({
      ...r,
      amountSats: String(r.amountSats),
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    // db not reachable yet — report zeros rather than failing the dashboard
  }

  const webhookSecrets = env.WEBHOOK_SECRETS;

  return NextResponse.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.2.0",
    nodeEnv: process.env.NODE_ENV ?? "development",
    store: { name: me.name, brandColor: me.brandColor, logoUrl: me.logoUrl },
    wallet: {
      mode: me.walletMode,
      confirmationsRequired: me.confirmationsRequired,
      invoiceExpiryMinutes: s.invoiceExpiryMinutes,
      lightning: me.lightningStatus,
      lastAddress: walletLastAddress,
      derivations: walletDerivations,
    },
    counts,
    webhooks: {
      urls: s.webhookUrls,
      secrets: webhookSecrets, // operator-only: needed to configure WooCommerce signature verification
    },
    recentInvoices,
    backup: { ...backupStatus(), enabled: s.backup.enabled, intervalHours: s.backup.intervalHours,
      remoteTarget: s.backup.remoteTarget ? s.backup.remoteTarget.replace(/^([^@]+)@/, "***@") : "",
      next: listBackups().sort((a, b) => (a.name < b.name ? 1 : -1))[0] ?? null },
  });
}
