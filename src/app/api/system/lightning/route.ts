/**
 * GET  /api/system/lightning — phoenixd connection status (Bearer required).
 * POST /api/system/lightning — connect the operator's OWN phoenixd (Bearer):
 *        { url, password } → live /getinfo handshake → stored ENCRYPTED at rest.
 *
 * Lightning is OPTIONAL. In "maximum" privacy mode it stays off regardless.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateConsole,
  stepUpSatisfied,
  STEP_UP_REQUIRED,
} from "@/lib/server/console-auth";
import { getSettings, saveSettings, resolveLightningPassword } from "@/lib/server/settings";
import { encryptServerSecret } from "@/lib/server/crypto-server";
import { phoenixdGetInfo } from "@/lib/server/lightning";
import { logSecurityEvent, SecurityEventType } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  url: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  clear: z.boolean().optional(),
});

export async function GET(req: Request) {
  if (!(await authenticateConsole(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const s = getSettings();
  return NextResponse.json({
    ok: true,
    url: s.lightning.url,
    connected: !!s.lightning.url && !!resolveLightningPassword(s),
    privacyMode: s.privacyMode,
    note: "password is stored encrypted (AES-256-GCM) and never returned",
  });
}

export async function POST(req: Request) {
  const auth = await authenticateConsole(req);
  if (!auth) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  // STEP-UP: connecting/disconnecting a node stores a credential.
  if (!stepUpSatisfied(auth)) {
    return NextResponse.json(STEP_UP_REQUIRED, { status: 403 });
  }

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "VALIDATION", issues: body.error.issues.slice(0, 3) }, { status: 400 });
  }
  const b = body.data;

  if (b.clear) {
    saveSettings({ lightning: { ...getSettings().lightning, url: null, password: "", passwordEnc: null } });
    logSecurityEvent({ type: SecurityEventType.LIGHTNING_UPDATED, req, detail: "phoenixd connection cleared" });
    return NextResponse.json({ ok: true, cleared: true });
  }

  // live handshake BEFORE storing anything — bad creds must never land on disk
  let node: { name?: string; pubkey?: string; chain?: string; version?: string };
  try {
    node = await phoenixdGetInfo(b.url, b.password);
  } catch (e) {
    return NextResponse.json(
      { error: "PHOENIXD_UNREACHABLE", detail: e instanceof Error ? e.message.slice(0, 200) : "handshake failed" },
      { status: 400 }
    );
  }

  saveSettings({
    lightning: { url: b.url, password: "", passwordEnc: encryptServerSecret(b.password) },
  });
  logSecurityEvent({
    type: SecurityEventType.LIGHTNING_UPDATED,
    severity: "warn",
    req,
    detail: `phoenixd connected and password encrypted at rest (${node.name ?? b.url.slice(0, 60)})`,
  });

  return NextResponse.json({ ok: true, node: { name: node.name ?? null, version: node.version ?? null, chain: node.chain ?? null } });
}
