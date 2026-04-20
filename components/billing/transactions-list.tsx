"use client";

import { useMemo } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Per-user credit-transaction ledger with optional `?jobId=` URL filter.
 *
 * When the URL carries a jobId the component:
 *   - Runs the scoped getTransactions({ jobId }) path (O(rows-for-job)
 *     via the by_job index).
 *   - Shows a clearable "filtered by job" chip.
 *
 * Without jobId, it falls back to the by_credits path (most recent 50).
 * Always renders a role="region" wrapper so tests can assert on the
 * semantic structure without coupling to Tailwind.
 */
export function TransactionsList() {
  const t = useTranslations("billingPage.transactions");
  const tCost = useTranslations("extraction.cost");
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawJobId = searchParams.get("jobId");
  const jobId = rawJobId ? (rawJobId as Id<"extractionJobs">) : undefined;

  const { data, settlement } = useProtectedQuery(
    api.credits.queries.getTransactions,
    jobId ? { jobId, limit: 200 } : { limit: 50 },
  );

  const rows = useMemo(() => data ?? [], [data]);

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
        <h2
          id="transactions-heading"
          className="text-base font-semibold"
        >
          {t("title")}
        </h2>
        {jobId && (
          <div
            className="flex items-center gap-2"
            data-transactions-scope="job"
          >
            <Badge variant="secondary" className="gap-1.5">
              <Link
                href={`/extraction/${jobId}`}
                className="hover:underline"
              >
                {t("filteredByJob")}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4"
                onClick={clearJobFilter}
                aria-label={t("clearFilter")}
              >
                <X className="h-3 w-3" />
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
        <ul className="divide-y divide-border/40">
          {rows.map((row) => {
            const billingTypeLabel = row.billingType
              ? tCost(
                  // map billingType → breakdown label key
                  row.billingType === "embedding"
                    ? "breakdown.indexing"
                    : row.billingType === "extraction_llm"
                      ? "breakdown.extraction"
                      : `breakdown.${row.billingType}`,
                )
              : null;
            const isDebit = row.amount < 0;
            return (
              <li
                key={row._id}
                className="flex items-center justify-between gap-4 py-2 text-sm"
                data-transaction-id={row._id}
                data-transaction-type={row.type}
                data-billing-type={row.billingType ?? "none"}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {row.description ?? row.type}
                    </span>
                    {billingTypeLabel && (
                      <Badge variant="outline" className="shrink-0">
                        {billingTypeLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(row.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
                <div
                  className={`shrink-0 tabular-nums font-semibold ${
                    isDebit ? "text-destructive" : "text-emerald-600"
                  }`}
                >
                  {isDebit ? row.amount : `+${row.amount}`}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
