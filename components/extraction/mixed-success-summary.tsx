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
import { PartyPopper } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

export interface MixedSuccessSummaryProps {
  jobId: Id<"extractionJobs">;
  /** Total questions × processable papers. Used for the "X / Y" ratio. */
  totalQuestions: number;
  /** Number of questions that produced an accepted answer. */
  answeredTotal: number;
}

export function MixedSuccessSummary({
  jobId,
  totalQuestions,
  answeredTotal,
}: MixedSuccessSummaryProps) {
  const t = useTranslations("extraction.mixedSuccess");
  const tTitle = useTranslations("errors.title");
  const headingId = useId();

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
      data-answered-total={answeredTotal}
      data-total-questions={totalQuestions}
      data-failed-total={summary.total}
      data-retryable-total={retryableTotal}
      className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4"
    >
      <div className="flex items-start gap-3">
        <PartyPopper
          className="mt-0.5 h-4 w-4 text-amber-600"
          aria-hidden="true"
        />
        <div className="space-y-2 text-sm">
          <h3 id={headingId} className="font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="text-muted-foreground">
            {t("answeredOverTotal", {
              answered: answeredTotal,
              total: totalQuestions,
            })}
          </p>
          <p>
            <span className="font-medium text-foreground">
              {t("failedTotal", { count: summary.total })}
            </span>{" "}
            <span className="text-muted-foreground">
              {summary.byCode
                .map(
                  (entry) =>
                    `${entry.count} ${tTitle(entry.code).toLowerCase()}`,
                )
                .join(", ")}
            </span>
          </p>
          <ul className="sr-only">
            {summary.byCode.map((entry) => (
              <li key={entry.code} data-failure-code={entry.code}>
                {entry.count} {tTitle(entry.code)}
              </li>
            ))}
          </ul>
          {retryableTotal > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("retryableHint", { count: retryableTotal })}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
