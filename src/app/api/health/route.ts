/**
 * Health check — liveness + database + chain provider visibility.
 *
 * 200 {ok:true, db:true}   — app AND database are alive
 * 503 {ok:false, db:false} — database unreachable (the process still answers,
 *                            which is exactly what tells the monitor things
 *                            are NOT fine)
 *
 * The `chain` block is INFORMATIVE and never changes the HTTP status by
 * itself: a fallen Esplora provider does not mean the node is dead — it
 * means payments cannot be detected. Machines watching for that flip
 * `chain.status` (or better: scrape /api/metrics → librepay_chain_provider_up),
 * and the node itself fires a signed alarm webhook the moment it happens.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getChainHealth } from "@/lib/server/chain-health";

export async function GET() {
  const chain = getChainHealth();
  const chainPublic = {
    status: chain.status,
    consecutiveFailures: chain.consecutiveFailures,
    provider: chain.provider,
    lastSuccessAt: chain.lastSuccessAt,
  };
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      db: true,
      chain: chainPublic,
      service: "librepay-node",
      ts: Date.now(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, db: false, chain: chainPublic, service: "librepay-node", ts: Date.now() },
      { status: 503 }
    );
  }
}
