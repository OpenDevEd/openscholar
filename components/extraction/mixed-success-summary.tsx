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
import { AlertTriangle } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { ERROR_CODES, type ErrorCode } from "@/lib/errors/taxonomy";

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

export interface MixedSuccessSummaryProps {
  jobId: Id<"extractionJobs">;
}

export function MixedSuccessSummary({ jobId }: MixedSuccessSummaryProps) {
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
      className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
        aria-hidden="true"
      />
      {/* One line: what happened, then what failed. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 id={headingId} className="font-medium text-foreground">
          {t("title")}
        </h3>
        <span className="text-muted-foreground">
          {t("answeredOverTotal", {
            answered: summary.answeredTotal,
            total: summary.totalQuestions,
          })}
        </span>
        <span>
          <span className="font-medium text-foreground">
            {t("failedTotal", { count: summary.total })}
          </span>{" "}
          <span className="text-muted-foreground">
            {summary.byCode
              .map(
                (entry) =>
                  `${entry.count} ${titleForCode(entry.code).toLowerCase()}`,
              )
              .join(", ")}
          </span>
        </span>
        <ul className="sr-only">
          {summary.byCode.map((entry) => (
            <li key={entry.code} data-failure-code={entry.code}>
              {entry.count} {titleForCode(entry.code)}
            </li>
          ))}
        </ul>
        {retryableTotal > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("retryableHint", { count: retryableTotal })}
          </span>
        ) : null}
      </div>
    </section>
  );
}
