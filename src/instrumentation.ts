/**
 * Next.js instrumentation hook — runs once when the server boots.
 * Starts the embedded chain-watcher unless the operator disabled it.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@/lib/server/cron");
  startScheduler();
}
