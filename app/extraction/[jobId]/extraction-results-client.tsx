"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Button } from "@/components/ui/button";
import { JobMetricsPanel } from "@/components/extraction/job-metrics-panel";
import { WorkbenchShell } from "@/components/extraction/workbench-shell";

interface ExtractionResultsClientProps {
  jobId: string;
}

export function ExtractionResultsClient({
  jobId,
}: ExtractionResultsClientProps) {
  const t = useTranslations("extraction");

  const { data } = useProtectedQuery(
    api.extraction.queries.getExtractionResults,
    { jobId: jobId as Id<"extractionJobs"> },
  );

  // Loading state: skeleton shimmer
  if (data === undefined) {
    return (
      <div className="container mx-auto max-w-4xl py-8 px-4 space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border p-6">
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  // Not found state
  if (data === null) {
    return (
      <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-lg text-center">
          <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h1 className="mb-2 text-xl font-semibold">
            {t("results.jobNotFound")}
          </h1>
          <Button variant="outline" asChild className="mt-4">
            <Link href="/extraction">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("progress.sidebarLabel")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Empty state (no papers)
  if (data.papers.length === 0) {
    return (
      <div className="container mx-auto max-w-4xl py-8 px-4 space-y-6">
        <h1 className="text-xl font-semibold">{t("results.title")}</h1>
        <JobMetricsPanel
          jobId={data.job._id}
          totalPapers={data.job.totalPapers}
        />
        <div className="flex min-h-[30vh] items-center justify-center">
          <div className="text-center">
            <h2 className="mb-2 text-lg font-semibold">
              {t("results.emptyHeading")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("results.emptyBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Results state
  return (
    <div className="container mx-auto max-w-6xl py-8 px-4 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("results.title")}</h1>
        <Button variant="outline" size="sm" asChild>
          <Link href="/extraction">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("progress.sidebarLabel")}
          </Link>
        </Button>
      </div>

      {/* Metrics panel */}
      <JobMetricsPanel
        jobId={data.job._id}
        totalPapers={data.job.totalPapers}
      />

      {/* Workbench with all views */}
      <WorkbenchShell
        data={data.papers}
        questions={data.job.questions}
        jobId={jobId}
        jobStatus={data.job.status}
      />
    </div>
  );
}
