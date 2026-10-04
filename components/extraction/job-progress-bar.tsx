"use client";

/**
 * Plan-07 — accessible job progress bar.
 *
 * Extracted from `app/extraction/[jobId]/page.tsx` so the semantic
 * contract can be unit-tested in isolation. The motion.div animation
 * and the surrounding "X / Y papers" caption live here; all width
 * calculations flow from the caller-supplied counts.
 *
 * Contract — per plan 07 and project testing doctrine:
 *   role="progressbar"    — exposes the progress role
 *   aria-label            — the job name so multiple bars on a page
 *                           are uniquely identifiable
 *   aria-valuenow         — current units processed (processed + failed)
 *   aria-valuemin=0
 *   aria-valuemax         — total units (totalPapers)
 *   aria-valuetext        — localized "N of M papers"
 *   data-progress-percent — numeric 0–100; stable test hook
 */

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

export interface JobProgressBarProps {
  /** Human-readable job name used as aria-label. */
  jobName: string;
  /** Successfully processed count. */
  processed: number;
  /** Permanently failed count. */
  failed: number;
  /** Total units of work. */
  total: number;
  /** The job finished, so the answered part turns green. */
  complete?: boolean;
}

function percentFromCounts(
  processed: number,
  failed: number,
  total: number,
): number {
  if (total <= 0) return 0;
  const pct = Math.round(((processed + failed) / total) * 100);
  // Clamp defensively — aggregated counters have been seen to over-/
  // undershoot during the finalize race; a negative aria-value or a
  // >100 visual width would look broken even if transient.
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

export function JobProgressBar({
  jobName,
  processed,
  failed,
  total,
  complete = false,
}: JobProgressBarProps) {
  const t = useTranslations("jobStatus");
  const percent = percentFromCounts(processed, failed, total);
  const processedPlusFailed = processed + failed;

  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={jobName}
        aria-valuenow={processedPlusFailed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={t("progressOfPapers", {
          processed: processedPlusFailed,
          total,
        })}
        data-progress-percent={percent}
        className="flex h-1.5 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {/* Answered papers, then failed ones in red, so the bar tells the outcome at a glance. */}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${total > 0 ? (processed / total) * 100 : 0}%` }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className={complete ? "h-full rounded-full bg-success" : "h-full rounded-full bg-primary"}
        />
        {failed > 0 ? (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${(failed / total) * 100}%` }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="h-full rounded-full bg-destructive"
          />
        ) : null}
      </div>
      <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {t("progressOfPapers", { processed: processedPlusFailed, total })}
      </span>
    </div>
  );
}
