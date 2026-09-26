"use client";

/**
 * Plan-07 — live "currently processing" banner for the job detail page.
 *
 * Subscribes to api.extraction.queries.nowProcessing.getNowProcessing,
 * which sources the in-flight paper from extractionPapers.by_job_status.
 * When no paper is in-flight, renders nothing (the progress bar below
 * already carries the job's headline state — a redundant "nothing is
 * happening" banner would only add noise).
 *
 * Contract — per project testing doctrine (assert on attributes, not
 * Tailwind strings):
 *   role="status"         — at-a-glance status, not an alert
 *   aria-live="polite"    — announce transitions to screen readers
 *   aria-atomic="true"    — re-read the whole banner on title change
 *   data-now-processing-paper  — stable test hook carrying the paper
 *                               title; absent when no paper is
 *                               in-flight
 *   data-paper-id         — stable id hook for deep-links
 */

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { TooltipHint } from "@/components/ui/tooltip";

export interface NowProcessingProps {
  jobId: Id<"extractionJobs">;
}

export function NowProcessing({ jobId }: NowProcessingProps) {
  const t = useTranslations("extraction.nowProcessing");

  const { data, settlement } = useProtectedQuery(
    api.extraction.queries.nowProcessing.getNowProcessing,
    { jobId },
  );

  // Idle / unowned / loading: render nothing. The progress bar above
  // already conveys job-level state, so an empty "currently" line would
  // be pure UI noise.
  if (settlement !== "ready" || !data) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={t("label", { title: data.paperTitle })}
      data-now-processing-paper={data.paperTitle}
      data-paper-id={data.paperId}
      className="inline-flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <Loader2
        className="h-3.5 w-3.5 animate-spin text-primary"
        aria-hidden="true"
      />
      <span className="font-medium text-foreground">
        {t("prefix")}
      </span>
      <TooltipHint label={data.paperTitle} onlyWhenClipped>
        <span className="truncate max-w-[48ch]">
          {data.paperTitle}
        </span>
      </TooltipHint>
    </div>
  );
}
