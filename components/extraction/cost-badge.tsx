"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface CostBadgeProps {
  jobId: Id<"extractionJobs">;
  /**
   * Optional inline-size variant for tight headers. Defaults to the
   * full chip rendering used in the job-detail header.
   */
  compact?: boolean;
  /**
   * When provided, the badge renders as a navigation link — no more
   * "View transactions" twin button next to it. Accessible name is
   * overridden to "View transactions ({amount})" so the link target is
   * unambiguous to screen readers.
   */
  href?: string;
}

/**
 * Live per-job credit-cost chip. Subscribes to
 * api.extraction.queries.costs.getJobCost (O(log n) via creditsAgg)
 * so the total updates in near-real-time as each question completes.
 *
 * Contract:
 *   role="status"         — the total is an at-a-glance status value
 *                           (not an alert; not a static definition).
 *   data-credits-total    — stable hook for tests, independent of the
 *                           formatted string (i18n + tabular-nums).
 *   Tooltip breakdown     — indexing vs extraction split from the
 *                           creditTransactions ledger, keyed to the
 *                           billingType taxonomy.
 *   href (optional)       — wraps the chip in a <Link>. Renders an
 *                           anchor the whole badge becomes clickable;
 *                           aria-label carries the navigation intent.
 */
export function CostBadge({ jobId, compact = false, href }: CostBadgeProps) {
  const t = useTranslations("extraction.cost");

  const { data, settlement } = useProtectedQuery(
    api.extraction.queries.costs.getJobCost,
    { jobId },
  );

  if (settlement !== "ready" || !data) {
    return (
      <span
        role="status"
        aria-busy="true"
        data-credits-total="0"
        className="inline-flex h-6 w-16 items-center rounded-md bg-muted/40"
      />
    );
  }

  const total = data.total;
  const breakdown = data.breakdown;
  const hasBreakdown =
    breakdown.extraction_llm > 0 ||
    breakdown.embedding > 0 ||
    breakdown.screening > 0 ||
    breakdown.chat > 0 ||
    breakdown.other > 0;

  const chipClasses = compact
    ? "inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-0.5 text-xs"
    : "inline-flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1 text-xs";

  const chipBody = (
    <>
      <Coins className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      <span className="font-semibold tabular-nums">
        {t("credits", { amount: total })}
      </span>
    </>
  );

  const trigger = href ? (
    <Link
      href={href}
      data-credits-total={String(total)}
      data-transactions-link="view"
      aria-label={t("viewTransactionsAria", { amount: total })}
      className={`${chipClasses} transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {chipBody}
    </Link>
  ) : (
    <span
      role="status"
      data-credits-total={String(total)}
      className={`${chipClasses} cursor-help`}
    >
      {chipBody}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        {hasBreakdown ? (
          <ul className="space-y-0.5 text-xs">
            {breakdown.embedding > 0 && (
              <li
                className="flex items-center justify-between gap-3"
                data-breakdown-bucket="embedding"
              >
                <span className="text-muted-foreground">
                  {t("breakdown.indexing")}
                </span>
                <span className="tabular-nums">
                  {breakdown.embedding.toLocaleString()}
                </span>
              </li>
            )}
            {breakdown.extraction_llm > 0 && (
              <li
                className="flex items-center justify-between gap-3"
                data-breakdown-bucket="extraction_llm"
              >
                <span className="text-muted-foreground">
                  {t("breakdown.extraction")}
                </span>
                <span className="tabular-nums">
                  {breakdown.extraction_llm.toLocaleString()}
                </span>
              </li>
            )}
            {breakdown.screening > 0 && (
              <li
                className="flex items-center justify-between gap-3"
                data-breakdown-bucket="screening"
              >
                <span className="text-muted-foreground">
                  {t("breakdown.screening")}
                </span>
                <span className="tabular-nums">
                  {breakdown.screening.toLocaleString()}
                </span>
              </li>
            )}
            {breakdown.chat > 0 && (
              <li
                className="flex items-center justify-between gap-3"
                data-breakdown-bucket="chat"
              >
                <span className="text-muted-foreground">
                  {t("breakdown.chat")}
                </span>
                <span className="tabular-nums">
                  {breakdown.chat.toLocaleString()}
                </span>
              </li>
            )}
            {breakdown.other > 0 && (
              <li
                className="flex items-center justify-between gap-3"
                data-breakdown-bucket="other"
              >
                <span className="text-muted-foreground">
                  {t("breakdown.other")}
                </span>
                <span className="tabular-nums">
                  {breakdown.other.toLocaleString()}
                </span>
              </li>
            )}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("credits", { amount: total })}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
