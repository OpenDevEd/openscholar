"use client";

/**
 * Plan-07 — inline per-paper question-progress indicator.
 *
 * Renders "4/5 · 1 retrying" next to a paper row so the user can see,
 * at a glance, how many questions have completed, how many are still
 * in-flight or retrying, and whether any have permanently failed. Pure
 * presentation — all counts are derived from the results array passed
 * in; the component itself owns no query.
 *
 * Contract — per project testing doctrine (assert on attributes, not
 * Tailwind strings):
 *   data-paper-status         — paper-level rollup, one of
 *                                {pending|extracting|completed|failed|
 *                                 downloading|indexing|
 *                                 download_failed|indexing_failed}
 *   data-question-progress    — "${completed}/${total}"; single test
 *                                hook that fully conveys progress
 *   data-completed-count      — numeric completed count
 *   data-total-count          — numeric total question count
 *   data-failed-count         — numeric permanently-failed count
 *   data-retrying-count       — numeric retrying count (in-flight with
 *                                attemptCount > 1)
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

type ResultStatus = "pending" | "extracting" | "completed" | "failed";
type PaperStatus =
  | "pending"
  | "downloading"
  | "download_failed"
  | "indexing"
  | "indexing_failed"
  | "extracting"
  | "completed"
  | "failed";

export type QuestionProgressResult = {
  status?: ResultStatus;
  attemptCount?: number;
};

export interface PaperQuestionProgressProps {
  paperStatus: PaperStatus;
  results: ReadonlyArray<QuestionProgressResult>;
  totalQuestions: number;
}

type Counts = {
  total: number;
  completed: number;
  failed: number;
  retrying: number;
};

function tallyCounts(
  results: ReadonlyArray<QuestionProgressResult>,
  totalQuestions: number,
): Counts {
  let completed = 0;
  let failed = 0;
  let retrying = 0;
  for (const r of results) {
    if (r.status === "completed") completed += 1;
    else if (r.status === "failed") failed += 1;
    if (
      r.status === "extracting" &&
      typeof r.attemptCount === "number" &&
      r.attemptCount > 1
    ) {
      retrying += 1;
    }
  }
  // Prefer the caller-provided total — the results array may trail the
  // paper's question count during initial seeding (pending rows).
  const total = Math.max(totalQuestions, results.length);
  return { total, completed, failed, retrying };
}

export function PaperQuestionProgress({
  paperStatus,
  results,
  totalQuestions,
}: PaperQuestionProgressProps) {
  const t = useTranslations("extraction.questionProgress");
  const { total, completed, failed, retrying } = useMemo(
    () => tallyCounts(results, totalQuestions),
    [results, totalQuestions],
  );

  return (
    <span
      role="group"
      aria-label={t("summary", { completed, total })}
      data-paper-status={paperStatus}
      data-question-progress={`${completed}/${total}`}
      data-completed-count={completed}
      data-total-count={total}
      data-failed-count={failed}
      data-retrying-count={retrying}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
    >
      <span className="font-medium text-foreground">
        {t("completedOverTotal", { completed, total })}
      </span>
      {failed > 0 ? (
        <span className="text-destructive" data-count-label="failed">
          {t("failedCount", { count: failed })}
        </span>
      ) : null}
      {retrying > 0 ? (
        <span data-count-label="retrying">
          {t("retryingCount", { count: retrying })}
        </span>
      ) : null}
    </span>
  );
}
