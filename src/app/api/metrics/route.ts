/**
 * GET /api/metrics — Prometheus text exposition (v0.8.0).
 *
 * GAUGES ONLY, computed live from SQLite at scrape time. That is a feature,
 * not a shortcut: gauges re-derived from the database cannot lie after a
 * reboot (in-process counters reset to 0 and Prometheus would read phantom
 * "improvements").
 *
 * Auth = console session cookie OR Bearer lp_live_ key. The Bearer check is
 * intentionally QUIET (no audit row per scrape) — a 15s Prometheus poll must
 * not flood the security monitor; WRONG keys still land in the audit log.
 *
 * Content-Type: text/plain; version=0.0.4 — scrape natively with:
 *   scrape_configs:
 *     - job_name: librepay-node
 *       metrics_path: /api/metrics
 *       scheme: https
 *       authorization:
 *         credentials: lp_live_...
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resolveConsoleSession } from "@/lib/server/console-auth";
import { hashApiKey } from "@/lib/server/api-auth";
import { getSettings } from "@/lib/server/settings";
import { getChainHealth } from "@/lib/server/chain-health";
import { getMerchant } from "@/lib/config";
import { env, walletConfigured } from "@/lib/env";
import { db } from "@/lib/db";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** Quiet auth — cookie session or Bearer key; no AUTH_OK spam per scrape. */
async function metricsAuth(req: Request): Promise<boolean> {
  const session = await resolveConsoleSession(req);
  if (session) return true;

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(lp_live_[a-f0-9]{48})$/i.exec(auth.trim());
  if (!m) return false;

  const presented = Buffer.from(hashApiKey(m[1]));
  const configHash = getSettings().apiKeyHash;
  const candidates = [configHash, env.API_KEY ? hashApiKey(env.API_KEY) : null].filter(
    (h): h is string => typeof h === "string"
  );
  for (const expected of candidates) {
    const b = Buffer.from(expected);
    if (presented.length === b.length && timingSafeEqual(presented, b)) return true;
  }
  // wrong key on the metrics port is worth seeing in the monitor
  const { logSecurityEvent, SecurityEventType } = await import("@/lib/server/audit");
  logSecurityEvent({ type: SecurityEventType.AUTH_FAILED, severity: "warn", req, detail: "wrong key on /api/metrics" });
  return false;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function num(v: number | null | undefined): number {
  return Number.isFinite(v as number) ? Math.round(v as number) : 0;
}

export async function GET(req: Request) {
  if (!(await metricsAuth(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const lines: string[] = [];
  const emit = (
    name: string,
    mtype: "gauge" | "counter" | "info",
    help: string,
    samples: { labels?: string; value: number }[]
  ) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${mtype}`);
    for (const s of samples) lines.push(`${name}${s.labels ? `{${s.labels}}` : ""} ${s.value}`);
  };

  // ── build / process ──
  const provider = getChainHealth().provider;
  emit("librepay_build_info", "info", "Build metadata (value is always 1)", [
    { labels: `version="${esc(String(pkg.version))}",node_env="${esc(env.NODE_ENV)}",provider="${esc(provider)}"`, value: 1 },
  ]);
  emit("librepay_process_uptime_seconds", "gauge", "Seconds since the node process started", [
    { value: Math.round(process.uptime()) },
  ]);
  emit("librepay_process_memory_rss_bytes", "gauge", "Resident set size of the node process", [
    { value: num(process.memoryUsage().rss) },
  ]);

  // ── database ──
  let dbUp = 1;
  let dbSize = 0;
  try {
    await db.$queryRaw`SELECT 1`;
    const pc = (await db.$queryRawUnsafe<{ page_count: number }[]>("PRAGMA page_count")) as {
      page_count: number;
    }[];
    const ps = (await db.$queryRawUnsafe<{ page_size: number }[]>("PRAGMA page_size")) as {
      page_size: number;
    }[];
    dbSize = num(Number(pc?.[0]?.page_count ?? 0) * Number(ps?.[0]?.page_size ?? 0));
  } catch {
    dbUp = 0;
  }
  emit("librepay_db_up", "gauge", "1 when the database answers (health gate)", [{ value: dbUp }]);
  emit("librepay_db_size_bytes", "gauge", "SQLite database file size", [{ value: dbSize }]);

  // ── invoices by status ──
  try {
    const byStatus = await db.invoice.groupBy({ by: ["status"], _count: { _all: true } });
    const total = await db.invoice.count();
    emit(
      "librepay_invoices",
      "gauge",
      "Invoices currently in each lifecycle status",
      byStatus.map((r) => ({ labels: `status="${esc(r.status)}"`, value: r._count._all }))
    );
    emit("librepay_invoices_total", "gauge", "All invoices ever created on this node", [{ value: total }]);

    const billed = await db.invoice.aggregate({ _sum: { amountSats: true } });
    const received = await db.invoice.aggregate({
      where: { status: { in: ["confirmed", "settled"] } },
      _sum: { receivedSats: true },
    });
    emit("librepay_invoice_sats_billed_total", "gauge", "Sum of invoiced amounts (sats)", [
      { value: Number(billed._sum.amountSats ?? 0n) },
    ]);
    emit("librepay_invoice_sats_received_total", "gauge", "Sum received on confirmed+settled invoices (sats)", [
      { value: Number(received._sum.receivedSats ?? 0n) },
    ]);
  } catch {
    // db down — librepay_db_up 0 above is the signal
  }

  // ── webhook outbox ──
  try {
    const byStatus = await db.webhookDelivery.groupBy({ by: ["status"], _count: { _all: true } });
    const due = await db.webhookDelivery.count({
      where: { status: "pending", nextRetryAt: { lte: new Date() } },
    });
    const dead = await db.webhookDelivery.count({ where: { status: "dead" } });
    emit(
      "librepay_webhook_deliveries",
      "gauge",
      "Outbox deliveries by status (pending/success/failed/dead)",
      byStatus.map((r) => ({ labels: `status="${esc(r.status)}"`, value: r._count._all }))
    );
    emit("librepay_webhook_outbox_due", "gauge", "Pending deliveries due for an attempt right now", [{ value: due }]);
    emit("librepay_webhook_outbox_dead", "gauge", "Deliveries exhausted (need operator redrive) — ALERT if > 0", [
      { value: dead },
    ]);
    emit("librepay_webhook_endpoints", "gauge", "Configured webhook endpoints", [{ value: env.WEBHOOK_URLS.length }]);
  } catch {
    // db down
  }

  // ── chain provider health (the outage alarm lives here) ──
  const chain = getChainHealth();
  emit("librepay_chain_provider_up", "gauge", "1 when the Esplora provider is answering — ALERT if 0 for > 2m", [
    { value: chain.status === "up" ? 1 : 0 },
  ]);
  emit("librepay_chain_provider_consecutive_failures", "gauge", "Consecutive chain-API failures (alarm fires at threshold)", [
    { value: chain.consecutiveFailures },
  ]);
  emit("librepay_chain_provider_latency_ms", "gauge", "Last successful chain-API call duration (ms)", [
    { value: num(chain.latencyMs) },
  ]);
  emit("librepay_chain_provider_last_success_age_seconds", "gauge", "Seconds since the last successful chain-API call", [
    { value: chain.lastSuccessAt ? num((Date.now() - new Date(chain.lastSuccessAt).getTime()) / 1000) : 0 },
  ]);
  emit("librepay_chain_provider_outages_total", "counter", "How many times the provider fell since process start", [
    { value: chain.downCount },
  ]);
  emit("librepay_chain_tip_height", "gauge", "Last observed chain tip height", [{ value: chain.tipHeight ?? 0 }]);
  emit("librepay_chain_tip_stalled_minutes", "gauge", "Minutes since the tip last advanced — ALERT if > LP_TIP_STALL_MINUTES", [
    { value: num(chain.tipStalledMinutes) },
  ]);

  // ── rails config ──
  const me = getMerchant();
  emit("librepay_wallet_configured", "gauge", "1 when an on-chain rail (payment code / zpub) is configured", [
    { value: walletConfigured() ? 1 : 0 },
  ]);
  emit("librepay_lightning_configured", "gauge", "1 when phoenixd (Lightning rail) is configured", [
    { value: me.lightningStatus === "ok" ? 1 : 0 },
  ]);

  return new NextResponse(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
