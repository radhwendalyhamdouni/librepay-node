/**
 * Chain provider health monitor — the Esplora outage ALARM (P0).
 *
 * "أضمن" must include the dependency the node LEAST controls: the Esplora
 * API. When it falls, invoice detection silently stops — the node looks
 * healthy (DB up, HTTP 200) while no payment is ever confirmed. This module
 * turns that silent failure into a loud one.
 *
 * How it works (all in-process, zero schema changes):
 *   - esplora.ts feeds every call result into recordChainSuccess/Failure()
 *   - N consecutive failures (LP_ESPLORA_FAIL_THRESHOLD, default 3) flip the
 *     state to "down" and fire a signed operator alarm ONCE
 *   - the next successful call flips back to "up" and fires the recovery
 *     alarm with the measured downtime
 *   - a provider that answers but never advances the tip (stale cache) fires
 *     system.esplora_stalled after LP_TIP_STALL_MINUTES (default 90)
 *
 * Alarm channels (all fire-and-forget — alarms must never break the cron):
 *   1. SecurityEvent audit row (console monitor renders it live)
 *   2. server log line
 *   3. notifyAdmins hook
 *   4. LP_ALARM_WEBHOOK_URL — one signed JSON POST (same HMAC contract as
 *      merchant webhooks, so examples/webhook-receiver works verbatim).
 *      Best-effort single POST by design: the state flip is also durable in
 *      the audit log and /api/metrics keeps the gauge at 0 until recovery,
 *      so a missed POST cannot hide an outage from a scraping Prometheus.
 */

import { env } from "@/lib/env";
import { logSecurityEvent, SecurityEventType } from "./audit";
import { notifyAdmins } from "./notify";
import { assertOutboundUrl } from "./ssrf-guard";
import { signPayload } from "./webhook";

export type ChainAlarmEvent =
  | "system.esplora_down"
  | "system.esplora_up"
  | "system.esplora_stalled";

/**
 * Next.js bundles each route as its own module graph — a plain module-level
 * object would give the cron scheduler, /api/metrics and /api/health THREE
 * independent views of the provider. Pinning the state onto globalThis makes
 * it ONE process-wide singleton (same trick as the Prisma client hot-reload
 * guard), so every route reports what the scheduler actually observed.
 */
interface ChainHealthState {
  status: "up" | "down";
  since: number; // ms epoch — when the current state began
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  latencyMs: number | null; // last successful call duration
  tipHeight: number | null;
  tipObservedAt: number | null; // last successful tip probe
  tipAdvancedAt: number | null; // last time the tip INCREASED
  tipStallAlarmed: boolean; // one alarm per stall episode
  downCount: number; // how many times the provider fell this process
  lastDownAt: number | null;
  lastUpAt: number | null;
}

const GLOBAL_KEY = "__librepayChainHealth" as const;

function freshState(): ChainHealthState {
  return {
    status: "up",
    since: Date.now(),
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    latencyMs: null,
    tipHeight: null,
    tipObservedAt: null,
    tipAdvancedAt: null,
    tipStallAlarmed: false,
    downCount: 0,
    lastDownAt: null,
    lastUpAt: null,
  };
}

const globalScope = globalThis as unknown as { [GLOBAL_KEY]?: ChainHealthState };
const state: ChainHealthState = (globalScope[GLOBAL_KEY] ??= freshState());

function failThreshold(): number {
  return env.ESPLORA_FAIL_THRESHOLD;
}

function tipStallMs(): number {
  return env.TIP_STALL_MINUTES * 60_000;
}

// ── feed points (called from esplora.ts) ────────────────────────────────────

/** A chain-API call succeeded. */
export function recordChainSuccess(latencyMs: number): void {
  const recovered = state.status === "down";
  state.status = "up";
  state.since = Date.now();
  state.consecutiveFailures = 0;
  state.lastSuccessAt = state.since;
  state.latencyMs = Math.max(0, Math.round(latencyMs));
  if (recovered) {
    state.lastUpAt = state.since;
    const downtimeS =
      state.lastDownAt != null ? Math.round((state.since - state.lastDownAt) / 1000) : null;
    fireAlarm("system.esplora_up", "info", {
      downtimeSeconds: downtimeS,
      latencyMs: state.latencyMs,
      provider: safeProviderHost(),
    });
  }
}

/** A chain-API call failed (HTTP error, timeout, network). */
export function recordChainFailure(detail: string): void {
  state.consecutiveFailures++;
  state.lastFailureAt = Date.now();
  state.lastError = detail.slice(0, 200);
  if (state.status === "up" && state.consecutiveFailures >= failThreshold()) {
    state.status = "down";
    state.since = Date.now();
    state.lastDownAt = state.since;
    state.downCount++;
    fireAlarm("system.esplora_down", "critical", {
      consecutiveFailures: state.consecutiveFailures,
      lastError: state.lastError,
      provider: safeProviderHost(),
    });
  }
}

/** getTipHeight() succeeded — feed block-stall detection. */
export function recordTipHeight(height: number): void {
  if (!Number.isFinite(height) || height <= 0) return;
  const now = Date.now();
  if (state.tipHeight === null || height > state.tipHeight) {
    state.tipAdvancedAt = now;
    state.tipStallAlarmed = false; // tip moved — stall episode over
  }
  state.tipHeight = Math.max(state.tipHeight ?? height, height);
  state.tipObservedAt = now;
  if (
    !state.tipStallAlarmed &&
    state.tipAdvancedAt !== null &&
    now - state.tipAdvancedAt > tipStallMs()
  ) {
    state.tipStallAlarmed = true;
    fireAlarm("system.esplora_stalled", "warn", {
      tipHeight: state.tipHeight,
      stalledMinutes: Math.round((now - state.tipAdvancedAt) / 60_000),
      provider: safeProviderHost(),
    });
  }
}

/** True while the provider is considered DOWN (cron uses this to de-grade). */
export function isChainDown(): boolean {
  return state.status === "down";
}

/** Safe display host of the configured provider (never the full URL with credentials). */
export function safeProviderHost(): string {
  try {
    return new URL(env.ESPLORA_API).host;
  } catch {
    return "invalid-url";
  }
}

export interface ChainHealthSnapshot {
  provider: string;
  status: "up" | "down";
  statusSince: string;
  consecutiveFailures: number;
  failThreshold: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  latencyMs: number | null;
  tipHeight: number | null;
  tipObservedAgeSeconds: number | null;
  tipStalledMinutes: number | null;
  downCount: number;
  lastDownAt: string | null;
  lastUpAt: string | null;
}

/** Serializable snapshot for /api/health, /api/system/status and /api/metrics. */
export function getChainHealth(): ChainHealthSnapshot {
  const now = Date.now();
  return {
    provider: safeProviderHost(),
    status: state.status,
    statusSince: new Date(state.since).toISOString(),
    consecutiveFailures: state.consecutiveFailures,
    failThreshold: failThreshold(),
    lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
    lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
    lastError: state.lastError,
    latencyMs: state.latencyMs,
    tipHeight: state.tipHeight,
    tipObservedAgeSeconds: state.tipObservedAt ? Math.round((now - state.tipObservedAt) / 1000) : null,
    tipStalledMinutes:
      state.tipAdvancedAt && state.tipHeight !== null
        ? Math.max(0, Math.round((now - state.tipAdvancedAt) / 60_000))
        : null,
    downCount: state.downCount,
    lastDownAt: state.lastDownAt ? new Date(state.lastDownAt).toISOString() : null,
    lastUpAt: state.lastUpAt ? new Date(state.lastUpAt).toISOString() : null,
  };
}

// ── alarm dispatch ──────────────────────────────────────────────────────────

function fireAlarm(event: ChainAlarmEvent, severity: "info" | "warn" | "critical", data: Record<string, unknown>): void {
  const text = alarmText(event, data);

  // 1 + 2: durable audit row + server log (always)
  logSecurityEvent({ type: SecurityEventType.CHAIN_ALARM, severity, detail: `${event} — ${text}` });
  if (severity === "critical") console.error(`[chain-alarm] ${event} — ${text}`);
  else console.warn(`[chain-alarm] ${event} — ${text}`);

  // 3: notify hook
  void notifyAdmins(event, data).catch(() => {});

  // 4: operator webhook — one signed, SSRF-guarded, best-effort POST
  const url = env.ALARM_WEBHOOK_URL;
  if (!url) return;
  void (async () => {
    try {
      assertOutboundUrl(url, {
        allowInsecureDev: env.NODE_ENV !== "production" || env.ALLOW_LOOPBACK_WEBHOOKS,
      });
    } catch (err) {
      logSecurityEvent({
        type: SecurityEventType.CHAIN_ALARM,
        severity: "warn",
        detail: `alarm webhook rejected by SSRF guard: ${err instanceof Error ? err.message : "blocked"}`,
      });
      return;
    }
    const payload = JSON.stringify({ event, severity, data: { ...data, text }, timestamp: Date.now() });
    const secret = env.ALARM_WEBHOOK_SECRET ?? env.WEBHOOK_SECRETS[0] ?? null;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "LibrePay-Node-Alarm/1.0",
      "x-librepay-event": event,
      "x-librepay-timestamp": String(Date.now()),
    };
    if (secret) headers["x-librepay-signature"] = signPayload(secret, payload);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5_000);
      const res = await fetch(url, { method: "POST", redirect: "manual", headers, body: payload, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) console.warn(`[chain-alarm] webhook answered HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[chain-alarm] webhook delivery failed: ${err instanceof Error ? err.message : "network error"}`);
    }
  })();
}

/** Human one-liner (the `text` field — Slack-style receivers render it directly). */
function alarmText(event: ChainAlarmEvent, data: Record<string, unknown>): string {
  const provider = safeProviderHost();
  switch (event) {
    case "system.esplora_down":
      return `Chain data provider DOWN — ${provider} after ${data.consecutiveFailures} consecutive failures (invoice detection paused). Last error: ${data.lastError ?? "unknown"}`;
    case "system.esplora_up":
      return `Chain data provider RECOVERED — ${provider} after ${data.downtimeSeconds ?? "?"}s downtime`;
    case "system.esplora_stalled":
      return `Chain tip STALLED — ${provider} stuck at block ${data.tipHeight} for ${data.stalledMinutes}m (provider cache or outage?)`;
  }
}

// ── test hooks (scripts/test-chain-health.ts only) ──────────────────────────

export function _resetForTests(): void {
  Object.assign(state, {
    status: "up",
    since: Date.now(),
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    latencyMs: null,
    tipHeight: null,
    tipObservedAt: null,
    tipAdvancedAt: null,
    tipStallAlarmed: false,
    downCount: 0,
    lastDownAt: null,
    lastUpAt: null,
  } satisfies ChainHealthState);
}

export function _stateForTests(): ChainHealthState {
  return state;
}
