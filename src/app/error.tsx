"use client";

/**
 * Route-level error boundary (App Router). Renders a privacy-reassuring
 * fallback and reports the error to the platform monitor automatically.
 * The report is scrubbed server-side: no customer data is ever included.
 */

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { reportClientError } from "@/lib/monitor/client-reporter";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    reportClientError({
      message: `${error.name}: ${error.message}`,
      stack: error.stack,
      severity: "error",
    });
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4" role="alert">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
          <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-lg font-semibold">{t("mon.errboundary.title")}</h1>
        <p className="mb-5 text-sm text-muted-foreground">{t("mon.errboundary.body")}</p>
        <Button onClick={reset} className="gap-2">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t("mon.errboundary.retry")}
        </Button>
      </div>
    </main>
  );
}
