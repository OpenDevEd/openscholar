"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast as sonnerToast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

export interface CompletionToastObserverProps {
  jobId: Id<"extractionJobs">;
  /**
   * Current job status. When it transitions from a non-terminal state
   * (extracting / downloading / indexing / pending) into "completed",
   * one toast fires with the final credit total and paper count.
   */
  jobStatus: string | undefined;
  /** Total papers the user originally submitted (for the toast body). */
  processedPapers: number;
}

/**
 * Headless observer that fires exactly one success toast per job
 * completion. Mounted inside JobDetailPage for extraction-mode jobs.
 *
 * Guards:
 *   - prev status is remembered via useRef so the effect only fires on
 *     the actual transition (not on mount-into-completed).
 *   - a local "already fired" flag prevents duplicate toasts from
 *     re-subscription reactivity churn.
 */
export function CompletionToastObserver({
  jobId,
  jobStatus,
  processedPapers,
}: CompletionToastObserverProps) {
  const t = useTranslations("extraction.cost");

  const { data: cost } = useProtectedQuery(
    api.extraction.queries.costs.getJobCost,
    { jobId },
  );

  const prevStatusRef = useRef<string | undefined>(jobStatus);
  const firedRef = useRef(false);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = jobStatus;
    prevStatusRef.current = next;

    if (firedRef.current) return;
    if (next !== "completed") return;
    // Only fire on a real transition — an extracting → completed flip
    // in the same session. Mounting directly into a completed job
    // should not toast.
    if (prev === undefined) return;
    if (prev === "completed") return;
    // Wait for the aggregate to settle before reading total. Subscribe
    // re-renders this effect once cost is ready.
    if (!cost) return;

    firedRef.current = true;
    sonnerToast.success(t("completionToastTitle"), {
      description: t("completionToast", {
        credits: cost.total,
        papers: processedPapers,
      }),
      duration: 6000,
    });
  }, [jobStatus, cost, processedPapers, t]);

  return null;
}
