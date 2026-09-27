/**
 * POST /api/setup/rotate-key — rotate the operator API key (Bearer required).
 * Returns the new raw key exactly once; only its sha256 is stored.
 */

import { NextResponse } from "next/server";
import { authenticateApiKey, generateApiKey } from "@/lib/server/api-auth";
import { getSettings, saveSettings } from "@/lib/server/settings";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const key = generateApiKey();
  saveSettings({ apiKeyHash: key.hash });
  logSecurityEvent({ type: SecurityEventType.KEY_ROTATED, severity: "critical", req, detail: "operator API key rotated — old key revoked" });
  return NextResponse.json(
    {
      ok: true,
      apiKey: key.raw, // shown ONCE
      note: "update your shop integration with the new key; the old key stops working immediately",
    },
    { status: 201 }
  );
}
