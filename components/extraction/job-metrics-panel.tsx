"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  FileCheck,
  Timer,
  DollarSign,
  AlertTriangle,
} from "lucide-react";

interface JobMetricsPanelProps {
  jobId: Id<"extractionJobs">;
  totalPapers: number;
}

export function JobMetricsPanel({ jobId, totalPapers }: JobMetricsPanelProps) {
  const t = useTranslations("extraction.jobMetrics");
  const metrics = useQuery(
    api.extraction.queries.getExtractionJobMetrics,
    { jobId }
  );

  // Loading state: skeleton
  if (metrics === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Unauthorized or not found: don't render
  if (metrics === null) return null;

  const {
    papersProcessed,
    averageLatencyMs,
    estimatedCostUsd,
    errorCount,
    citationValidityRate,
    recallOnInclude,
  } = metrics;

  // Format helpers
  const formatLatency = (ms: number | null): string =>
    ms !== null ? `${(ms / 1000).toFixed(1)}s` : t("nullValue");

  const formatCost = (usd: number): string =>
    usd > 0 ? `$${usd.toFixed(4)}` : t("nullValue");

  const formatPercent = (rate: number | null): string =>
    rate !== null ? `${(rate * 100).toFixed(1)}%` : t("nullValue");

  // SLO threshold color
  const getSloColor = (rate: number | null): string => {
    if (rate === null) return "text-muted-foreground";
    if (rate >= 0.95) return "text-[oklch(0.55_0.15_145)]";
    if (rate >= 0.80) return "text-[oklch(0.6_0.12_85)]";
    return "text-destructive";
  };

  const getSloProgressColor = (rate: number | null): string => {
    if (rate === null) return "";
    if (rate >= 0.95) return "[&>div]:bg-[oklch(0.55_0.15_145)]";
    if (rate >= 0.80) return "[&>div]:bg-[oklch(0.6_0.12_85)]";
    return "[&>div]:bg-destructive";
  };

  const getSloTooltipSuffix = (rate: number | null): string => {
    if (rate === null) return "";
    if (rate >= 0.95) return ` -- ${t("sloMet")}`;
    if (rate >= 0.80) return ` -- ${t("sloAtRisk")}`;
    return ` -- ${t("sloViolated")}`;
  };

  const remaining = totalPapers - papersProcessed - errorCount;

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 2x2 metric grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Papers Processed */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  role="group"
                  aria-label={`${t("papersProcessed")}: ${papersProcessed} / ${totalPapers}`}
                  className="flex items-center gap-3 rounded-md p-3"
                >
                  <FileCheck className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xl font-semibold leading-tight">
                      {papersProcessed} / {totalPapers}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("papersProcessed")}
                    </p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {t("papersTooltip", {
                  processed: papersProcessed,
                  failed: errorCount,
                  remaining: Math.max(0, remaining),
                })}
              </TooltipContent>
            </Tooltip>

            {/* Avg Latency */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  role="group"
                  aria-label={`${t("avgLatency")}: ${formatLatency(averageLatencyMs)}`}
                  className="flex items-center gap-3 rounded-md p-3"
                >
                  <Timer className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className={`text-xl font-semibold leading-tight ${averageLatencyMs === null ? "text-muted-foreground" : ""}`}>
                      {formatLatency(averageLatencyMs)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("avgLatency")}
                    </p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {averageLatencyMs !== null
                  ? t("latencyTooltip")
                  : t("nullLatency")}
              </TooltipContent>
            </Tooltip>

            {/* Estimated Cost */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  role="group"
                  aria-label={`${t("estimatedCost")}: ${formatCost(estimatedCostUsd)}`}
                  className="flex items-center gap-3 rounded-md p-3"
                >
                  <DollarSign className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className={`text-xl font-semibold leading-tight ${estimatedCostUsd === 0 ? "text-muted-foreground" : ""}`}>
                      {formatCost(estimatedCostUsd)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("estimatedCost")}
                    </p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {estimatedCostUsd > 0
                  ? t("costTooltip")
                  : t("nullCost")}
              </TooltipContent>
            </Tooltip>

            {/* Errors */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  role="group"
                  aria-label={`${t("errors")}: ${errorCount}`}
                  className="flex items-center gap-3 rounded-md p-3"
                >
                  <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-semibold leading-tight">
                      {errorCount}
                    </p>
                    {errorCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {errorCount}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground sr-only">
                    {t("errors")}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {errorCount > 0
                  ? t("errorsTooltip", { count: errorCount })
                  : t("errors")}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* SLO Section */}
          {citationValidityRate !== null && (
            <>
              <Separator />
              <div className="space-y-3">
                {/* Citation Validity */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t("citationValidity")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger>
                        <span className={`font-semibold ${getSloColor(citationValidityRate)}`}>
                          {formatPercent(citationValidityRate)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("citationValidity")}: {formatPercent(citationValidityRate)}
                        {getSloTooltipSuffix(citationValidityRate)}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Progress
                    value={(citationValidityRate ?? 0) * 100}
                    className={`h-2 ${getSloProgressColor(citationValidityRate)}`}
                    aria-label={`${t("citationValidity")}: ${formatPercent(citationValidityRate)}`}
                  />
                </div>

                {/* Recall on Include */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t("recallOnInclude")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger>
                        <span className={`font-semibold ${getSloColor(recallOnInclude)}`}>
                          {recallOnInclude !== null
                            ? formatPercent(recallOnInclude)
                            : t("pending")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {recallOnInclude !== null
                          ? `${t("recallOnInclude")}: ${formatPercent(recallOnInclude)}${getSloTooltipSuffix(recallOnInclude)}`
                          : t("nullRecallOnInclude")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {recallOnInclude !== null && (
                    <Progress
                      value={(recallOnInclude ?? 0) * 100}
                      className={`h-2 ${getSloProgressColor(recallOnInclude)}`}
                      aria-label={`${t("recallOnInclude")}: ${formatPercent(recallOnInclude)}`}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
