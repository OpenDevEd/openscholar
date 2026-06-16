"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

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
 * Live per-job credit-cost chip. Subscribes to the per-job aggregate total only.
 *
 * Contract:
 *   role="status"         — the total is an at-a-glance status value
 *                           (not an alert; not a static definition).
 *   data-credits-total    — stable hook for tests, independent of the
 *                           formatted string (i18n + tabular-nums).
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
      className={chipClasses}
    >
      {chipBody}
    </span>
  );

  return trigger;
}
