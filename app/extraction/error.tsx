"use client";

import { useTranslations } from "next-intl";
import Link from "@/components/workspace-link";
import { AlertTriangle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useChunkReload } from "@/lib/chunk-reload";
import { useReportPageError } from "@/lib/report-page-error";

export default function ExtractionErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPages");
  const tc = useTranslations("common");
  useReportPageError("app/extraction/error", error);
  const { reloading, retry } = useChunkReload(error, reset);

  if (reloading) return null;

  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-semibold">{t("extractionUnavailable")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("extractionErrorDescription")}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={retry}>{tc("retry")}</Button>
          <Button variant="outline" asChild>
            <Link href="/extraction">{t("backToJobs")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
