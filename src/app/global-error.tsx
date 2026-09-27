"use client";

/**
 * Global error boundary — renders when the ROOT LAYOUT itself crashes, so
 * it owns its own <html>/<body> and cannot rely on providers. Text is kept
 * bilingual (EN + AR) statically on purpose: the i18n provider is unavailable
 * here. The error is reported to the platform monitor (server-side scrubbed).
 */

import { useEffect } from "react";
import { reportClientError } from "@/lib/monitor/client-reporter";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: `${error.name}: ${error.message}`,
      stack: error.stack,
      severity: "critical",
    });
  }, [error]);

  return (
    <html lang="en" dir="ltr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans Arabic', sans-serif",
          background: "#09090b",
          color: "#fafafa",
        }}
      >
        <main role="alert" style={{ maxWidth: 420, padding: "2rem", textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              margin: "0 auto 1rem",
              borderRadius: "9999px",
              background: "rgba(239,68,68,.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
            }}
            aria-hidden="true"
          >
            ⚠
          </div>
          <h1 style={{ fontSize: "1.1rem", margin: "0 0 .5rem" }}>Something went wrong</h1>
          <p style={{ fontSize: ".875rem", color: "#a1a1aa", margin: "0 0 .5rem" }} dir="ltr">
            The error was reported automatically. No personal or payment data was included.
          </p>
          <p style={{ fontSize: ".875rem", color: "#a1a1aa", margin: "0 0 1.25rem" }} dir="rtl" lang="ar">
            تم الإبلاغ عن الخطأ تلقائياً — دون أي بيانات شخصية أو بيانات دفع.
          </p>
          <button
            onClick={reset}
            style={{
              padding: ".5rem 1.25rem",
              borderRadius: ".6rem",
              border: "1px solid #3f3f46",
              background: "#fafafa",
              color: "#18181b",
              fontWeight: 600,
              fontSize: ".875rem",
              cursor: "pointer",
            }}
          >
            Try again · إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
