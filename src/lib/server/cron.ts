/**
 * Embedded scheduler — LibrePay Node watches the chain by itself.
 * The platform edition needed an external cron hitting /api/cron/*;
 * the node runs cronTick() in-process on an interval (LP_CRON_INTERVAL_MS,
 * default 30s). Systemd-timer operators can set it to 0 and use the
 * /api/cron/tick endpoint guarded by LP_CRON_SECRET instead.
 */

import { cronTick } from "./invoice-events";
import { maybeBackup } from "./backup";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startScheduler(): void {
  if (timer) return; // singleton across hot reloads
  const ms = Number(process.env.LP_CRON_INTERVAL_MS ?? 30_000);
  if (!Number.isFinite(ms) || ms < 5_000) return;
  timer = setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await cronTick();
      await maybeBackup(); // periodic encrypted backup + off-server push
    } catch (err) {
      console.error("[cron]", err);
    } finally {
      running = false;
    }
  }, ms);
  // do not keep the event loop alive just for the scheduler
  timer.unref?.();
  console.log(`[cron] embedded scheduler every ${Math.round(ms / 1000)}s`);
}
