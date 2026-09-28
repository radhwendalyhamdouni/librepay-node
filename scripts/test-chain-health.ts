/**
 * Chain health monitor tests (run: bun scripts/test-chain-health.ts).
 *
 * E2E for the Esplora outage alarm — P0 "الصحة الذاتية":
 *   1. failures below threshold  → state stays up, NO alarm POST
 *   2. threshold crossing        → down + signed system.esplora_down POST
 *   3. next success              → up + system.esplora_up with downtime
 *   4. stale tip (no advance)    → system.esplora_stalled once, auto-clears
 *   5. signature is HMAC-SHA256 hex of the raw body (same contract as the
 *      merchant webhooks — examples/webhook-receiver-node.mjs verifies this)
 */
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// test config BEFORE imports consume env
process.env.LP_ALLOW_LOOPBACK_WEBHOOKS = "true"; // loopback receiver (test only)
process.env.LP_ALARM_WEBHOOK_SECRET = "test-alarm-secret-0123456789abcdef";
process.env.LP_TIP_STALL_MINUTES = "10"; // minimum — keeps the stall test fast
process.env.LP_ESPLORA_FAIL_THRESHOLD = "3";

import {
  recordChainFailure,
  recordChainSuccess,
  recordTipHeight,
  isChainDown,
  getChainHealth,
  _resetForTests,
  _stateForTests,
} from "../src/lib/server/chain-health";

interface Received {
  event: string;
  body: string;
  signature: string | null;
}
const received: Received[] = [];

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (c: Buffer) => (body += c.toString()));
  req.on("end", () => {
    received.push({
      event: String(req.headers["x-librepay-event"] ?? ""),
      body,
      signature: (req.headers["x-librepay-signature"] as string) ?? null,
    });
    res.writeHead(200).end("ok");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const addr = server.address();
if (!addr || typeof addr === "string") throw new Error("no receiver port");
process.env.LP_ALARM_WEBHOOK_URL = `http://127.0.0.1:${addr.port}/alarm`;

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

async function waitFor(n: number, ms = 5000): Promise<Received[]> {
  const t0 = Date.now();
  while (received.length < n && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50));
  return received.splice(0);
}

function verifySignature(sig: string | null, body: string, label: string) {
  const expected = "sha256=" + createHmac("sha256", process.env.LP_ALARM_WEBHOOK_SECRET!).update(body).digest("hex");
  ok(sig === expected, `${label} — HMAC signature valid`);
}

console.log("— threshold: 2 failures stay silent, 3rd fires the alarm —");
_resetForTests();
recordChainFailure("HTTP 503 on /blocks/tip/height");
recordChainFailure("HTTP 503 on /address/x/txs");
ok(!isChainDown(), "2 consecutive failures → still up");
ok(getChainHealth().consecutiveFailures === 2, "failure counter = 2");
ok(getChainHealth().status === "up", "status = up");
recordChainFailure("HTTP 503 on /v1/prices");
ok(isChainDown(), "3rd failure → DOWN");
ok(getChainHealth().downCount === 1, "outage counter incremented");
let batch = await waitFor(1);
ok(batch.length === 1, "exactly ONE alarm POST fired");
if (batch[0]) {
  ok(batch[0].event === "system.esplora_down", "event = system.esplora_down");
  const parsed = JSON.parse(batch[0].body) as { data: { consecutiveFailures: number; text: string } };
  ok(parsed.data.consecutiveFailures === 3, "payload carries failure count");
  ok(typeof parsed.data.text === "string" && parsed.data.text.includes("DOWN"), "human text field present");
  verifySignature(batch[0].signature, batch[0].body, "down alarm");
}

console.log("— recovery: one success flips up + fires system.esplora_up —");
await new Promise((r) => setTimeout(r, 20));
recordChainSuccess(142);
ok(!isChainDown(), "success → UP again");
batch = await waitFor(1);
ok(batch.length === 1, "exactly ONE recovery POST");
if (batch[0]) {
  ok(batch[0].event === "system.esplora_up", "event = system.esplora_up");
  const parsed = JSON.parse(batch[0].body) as { data: { downtimeSeconds: number | null; latencyMs: number } };
  ok(parsed.data.downtimeSeconds !== null && parsed.data.downtimeSeconds >= 0, "downtime measured");
  ok(parsed.data.latencyMs === 142, "latency recorded");
  verifySignature(batch[0].signature, batch[0].body, "up alarm");
}

console.log("— tip stall: stuck tip alarms once, advancing clears it —");
_resetForTests();
recordTipHeight(867000);
ok(getChainHealth().tipHeight === 867000, "tip recorded");
// simulate 11 minutes without a block advance
_stateForTests().tipAdvancedAt = Date.now() - 11 * 60_000;
recordTipHeight(867000);
batch = await waitFor(1);
ok(batch.length === 1 && batch[0].event === "system.esplora_stalled", "stalled tip → system.esplora_stalled");
ok(_stateForTests().tipStallAlarmed === true, "stall latch set (no alarm storm)");
recordTipHeight(867001); // a new block arrives
ok(getChainHealth().tipHeight === 867001, "tip advanced");
ok(_stateForTests().tipStallAlarmed === false, "latch cleared on advance");
const quiet = await waitFor(0, 400);
ok(quiet.length === 0, "no extra alarms after latch (single-shot)");

console.log(`\n${passed} passed, ${failed} failed`);
server.close();
process.exit(failed === 0 ? 0 : 1);
