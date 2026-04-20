"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { TransactionRow } from "@/components/billing/transactions/transaction-row";

/**
 * Per-user credit-transaction ledger with optional `?jobId=` URL filter.
 *
 * When the URL carries a jobId the component:
 *   - Runs the scoped getTransactions({ jobId }) path (O(rows-for-job)
 *     via the by_job index).
 *   - Shows a clearable "filtered by job" chip.
 *
 * Without jobId, it falls back to the by_credits path (most recent 50).
 */
export function TransactionsList() {
  const t = useTranslations("billingPage.transactions");
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawJobId = searchParams.get("jobId");
  const jobId = rawJobId ? (rawJobId as Id<"extractionJobs">) : undefined;

  const { data, settlement } = useProtectedQuery(
    api.credits.queries.getTransactions,
    jobId ? { jobId, limit: 200 } : { limit: 50 },
  );

  const rows = useMemo(() => (data ?? []).map(toViewModel), [data]);

  const clearJobFilter = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("jobId");
    const qs = next.toString();
    router.replace(`/settings/billing${qs ? `?${qs}` : ""}`);
  };

  return (
    <section
      role="region"
      aria-labelledby="transactions-heading"
      data-transactions-filter={jobId ?? "none"}
      className="rounded-xl border border-border/40 bg-card/90 p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="transactions-heading" className="text-base font-semibold">
          {t("title")}
        </h2>
        {jobId && (
          <div
            className="flex items-center gap-2"
            data-transactions-scope="job"
          >
            <Badge variant="secondary" className="gap-1.5">
              <Link href={`/extraction/${jobId}`} className="hover:underline">
                {t("filteredByJob")}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4"
                onClick={clearJobFilter}
                aria-label={t("clearFilter")}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            </Badge>
          </div>
        )}
      </div>

      {settlement !== "ready" ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-transactions-empty="true"
        >
          {jobId ? t("emptyForJob") : t("empty")}
        </p>
      ) : (
        <div
          role="list"
          className="flex flex-col divide-y divide-border/40"
          data-transactions-list=""
        >
          {rows.map((row) => (
            <TransactionRow key={row.id} row={row} density="comfortable" />
          ))}
        </div>
      )}
    </section>
  );
}
