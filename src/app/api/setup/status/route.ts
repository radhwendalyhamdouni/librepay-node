/**
 * GET /api/setup/status — public, minimal.
 * The landing page uses `configured` to decide between the first-run
 * Setup Wizard and the normal node front page. No secrets, ever.
 */

import { NextResponse } from "next/server";
import { getSetupToken, isConfigured } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isConfigured();
  if (!configured) {
    // materialize data/SETUP_TOKEN so the operator can always find it with
    // `cat data/SETUP_TOKEN` — even before the wizard ever ran
    getSetupToken();
  }
  return NextResponse.json({
    configured,
    setupRequired: !configured,
    tokenPath: configured ? null : "data/SETUP_TOKEN",
  });
}
