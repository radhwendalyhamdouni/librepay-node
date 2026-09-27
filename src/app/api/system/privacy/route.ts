/**
 * POST /api/system/privacy — switch the node's privacy posture (Bearer).
 *   standard  → convenience first: Lightning first when connected
 *   balanced  → default: on-chain stealth + Lightning for small fast amounts
 *   maximum   → on-chain stealth/payment-code ONLY; Lightning off everywhere
 *
 * GET returns the current mode.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateConsole } from "@/lib/server/console-auth";
import { getSettings, saveSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["standard", "balanced", "maximum"]),
});

export async function GET(req: Request) {
  if (!(await authenticateConsole(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, mode: getSettings().privacyMode });
}

export async function POST(req: Request) {
  if (!(await authenticateConsole(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "VALIDATION", issues: body.error.issues.slice(0, 3) }, { status: 400 });
  }
  saveSettings({ privacyMode: body.data.mode });
  return NextResponse.json({ ok: true, mode: body.data.mode });
}
