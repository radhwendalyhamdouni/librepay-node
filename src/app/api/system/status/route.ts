/**
 * GET /api/system/status — operator dashboard payload (Bearer required).
 * Node health + wallet mode + backup state. No secrets.
 */

import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/server/api-auth";
import { getMerchant } from "@/lib/config";
import { getSettings } from "@/lib/server/settings";
import { backupStatus, listBackups } from "@/lib/server/backup";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const me = getMerchant();
  const s = getSettings();
  let counts = { invoices: 0, paid: 0 };
  try {
    const [{ db: client }] = await Promise.all([import("@/lib/db")]);
    counts.invoices = await client.invoice.count();
    counts.paid = await client.invoice.count({
      where: { status: { in: ["confirmed", "settled"] } },
    });
  } catch {
    // db not reachable yet — report zeros rather than failing the dashboard
  }

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
    },
    counts,
    backup: { ...backupStatus(), enabled: s.backup.enabled, intervalHours: s.backup.intervalHours,
      remoteTarget: s.backup.remoteTarget ? s.backup.remoteTarget.replace(/^([^@]+)@/, "***@") : "",
      next: listBackups().sort((a, b) => (a.name < b.name ? 1 : -1))[0] ?? null },
  });
}
