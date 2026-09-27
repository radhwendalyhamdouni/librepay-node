/**
 * Client error reporter stub — the node has no monitoring pipeline.
 * Errors surface in the server/browser console only. Honest and quiet.
 */

export function reportClientError(err: unknown, ctx?: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "production") {
    console.error("[client]", err, ctx ?? {});
  }
}
