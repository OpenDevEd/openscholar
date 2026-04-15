"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useConvex } from "convex/react";
import { AlertTriangle, ArrowLeft, Download, Loader2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JobMetricsPanel } from "@/components/extraction/job-metrics-panel";
import { PaperResultCard } from "@/components/extraction/paper-result-card";
import {
  exportExtractionToCSV,
  exportExtractionToJSON,
  exportExtractionToXLSX,
} from "@/lib/extraction/export";
import type { ExtractionExportData } from "@/lib/extraction/export";
import { showStyledToast } from "@/components/ui/sonner";

interface ExtractionResultsClientProps {
  jobId: string;
}

export function ExtractionResultsClient({
  jobId,
}: ExtractionResultsClientProps) {
  const t = useTranslations("extraction");
  const convex = useConvex();
  const [isExporting, setIsExporting] = useState(false);

  const { data } = useProtectedQuery(
    api.extraction.queries.getExtractionResults,
    { jobId: jobId as Id<"extractionJobs"> },
  );

  async function handleExport(fmt: "csv" | "json" | "xlsx") {
    setIsExporting(true);
    try {
      const exportData = await convex.query(
        api.extraction.queries.getExtractionResultsForExport,
        { jobId: jobId as Id<"extractionJobs"> },
      );
      if (!exportData) return;
      switch (fmt) {
        case "csv":
          exportExtractionToCSV(exportData as ExtractionExportData);
          break;
        case "json":
          exportExtractionToJSON(exportData as ExtractionExportData);
          break;
        case "xlsx":
          await exportExtractionToXLSX(exportData as ExtractionExportData);
          break;
      }
    } catch (err) {
      console.error("Export failed:", err);
      showStyledToast("error", t("export.incompleteWarning"));
    } finally {
      setIsExporting(false);
    }
  }

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
    <div className="container mx-auto max-w-4xl py-8 px-4 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("results.title")}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t("export.csv").replace("Download ", "")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {data.job.status !== "completed" && (
              <div className="px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 border-b border-border/40 mb-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {t("export.incompleteWarning")}
              </div>
            )}
            <DropdownMenuItem onClick={() => handleExport("csv")}>
              {t("export.csv")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("json")}>
              {t("export.json")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("xlsx")}>
              {t("export.xlsx")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Metrics panel */}
      <JobMetricsPanel
        jobId={data.job._id}
        totalPapers={data.job.totalPapers}
      />

      {/* Paper result cards */}
      {data.papers.map((paper, index) => (
        <PaperResultCard
          key={paper._id}
          paper={paper}
          questions={data.job.questions}
          index={index}
        />
      ))}
    </div>
  );
}
