"use client";

/**
 * Plan-07 — mixed-success callout for a completed-with-failures job.
 *
 * Narrative summary: "Completed with partial success — 473 / 500
 * questions answered. 27 failed: 15 rate limits, 8 PDF invalid, 4
 * context too long." Paired with <RetrySummary> which owns the action
 * affordance; this component stays narrative-only so the two don't
 * shadow each other.
 *
 * Contract — per project testing doctrine (assert on attributes, not
 * Tailwind strings):
 *   role="region"                 — landmark for screen readers
 *   aria-labelledby               — points to the heading (Radix-free)
 *   data-mixed-success-summary    — test hook on the container
 *   data-answered-total           — numeric answered count
 *   data-total-questions          — numeric total question count
 *   data-failed-total             — numeric total failure count
 *   data-retryable-total          — numeric retryable subset of failures
 *   data-failure-code             — per breakdown row, the taxonomy code
 *
 * Renders nothing when the summary has no failure rows (no callout
 * needed) or is still loading.
 */

import { useId } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { ERROR_CODES, type ErrorCode } from "@/lib/errors/taxonomy";

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

export interface MixedSuccessSummaryProps {
  jobId: Id<"extractionJobs">;
  /** Filters the results to the papers that failed. */
  onShowFailures?: () => void;
}

export function MixedSuccessSummary({ jobId, onShowFailures }: MixedSuccessSummaryProps) {
  const t = useTranslations("extraction.mixedSuccess");
  const tTitle = useTranslations("errors.title");
  const headingId = useId();

  // The query widens `code` to `string` for forward-compat with codes
  // the taxonomy doesn't yet recognise. Fall back to the raw code
  // string (humanised) when the translation key is absent, so a future
  // classifier revision never renders a blank cell.
  const titleForCode = (code: string): string =>
    KNOWN_CODES.has(code) ? tTitle(code as ErrorCode) : code.replace(/_/g, " ");

  const { data: summary, settlement } = useProtectedQuery(
    api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary,
    { jobId },
  );

  // Only render on the happy-path: query ready and there's at least
  // one classified failure. On a clean completed job nothing renders.
  if (settlement !== "ready" || !summary || summary.total === 0) return null;

  const retryableTotal = summary.byCode.reduce(
    (acc, entry) => (entry.retryable ? acc + entry.count : acc),
    0,
  );

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      data-mixed-success-summary
      data-answered-total={summary.answeredTotal}
      data-total-questions={summary.totalQuestions}
      data-failed-total={summary.total}
      data-retryable-total={retryableTotal}
      className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
    >
      <h3 id={headingId} className="sr-only">
        {t("title")}
      </h3>
      {/* A legend for the bar above: what worked, then each reason something failed. */}
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CircleCheck aria-hidden className="size-4 text-emerald-600 dark:text-emerald-400" />
        {t("answeredOverTotal", {
          answered: summary.answeredTotal,
          total: summary.totalQuestions,
        })}
      </span>
      {summary.byCode.map((entry) => (
        <span key={entry.code} data-failure-code={entry.code} className="inline-flex items-center gap-1.5">
          <CircleX aria-hidden className="size-4 text-destructive" />
          {titleForCode(entry.code)}
          <span className="tabular-nums text-muted-foreground">{entry.count}</span>
        </span>
      ))}
      {retryableTotal > 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("retryableHint", { count: retryableTotal })}
        </span>
      ) : null}
      {onShowFailures ? (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={onShowFailures}>
          {t("showFailed")}
        </Button>
      ) : null}
    </section>
  );
}
