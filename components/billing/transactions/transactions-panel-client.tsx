"use client";

import { useMemo, useRef } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedPaginatedQuery } from "@/lib/auth/use-auth-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toViewModel } from "@/lib/billing/transactions/transaction-view-model";
import {
  partitionByGroup,
  shouldRenderGroups,
  type GroupKey,
} from "@/lib/billing/transactions/grouping";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { TransactionRow } from "./transaction-row";
import { TransactionsPanelHeader, type TransactionsSummary } from "./transactions-panel-header";
import { TransactionsGroupHeader } from "./transactions-group-header";
import { TransactionsListSkeleton } from "./transactions-list-skeleton";
import { useTransactionsLoadMore } from "./use-transactions-load-more";

interface Props {
  jobId?: Id<"extractionJobs">;
}

function summarize(rows: readonly TransactionViewModel[]): TransactionsSummary {
  let inAmount = 0;
  let outAmount = 0;
  for (const row of rows) {
    if (row.direction === "in") inAmount += row.amount;
    else outAmount += row.amount;
  }
  return { in: inAmount, out: outAmount, net: inAmount - outAmount };
}

function RowList({ rows }: { rows: readonly TransactionViewModel[] }) {
  return (
    <div role="list" className="divide-y divide-border/40">
      {rows.map((row) => (
        <TransactionRow key={row.id} row={row} density="comfortable" />
      ))}
    </div>
  );
}

function GroupedRowList({
  groups,
}: {
  groups: ReadonlyArray<readonly [GroupKey, readonly TransactionViewModel[]]>;
}) {
  return (
    <>
      {groups.map(([groupKey, groupRows]) => (
        <section
          key={groupKey}
          data-transactions-group={groupKey}
          aria-label={groupKey}
        >
          <TransactionsGroupHeader groupKey={groupKey} />
          <RowList rows={groupRows} />
        </section>
      ))}
    </>
  );
}

export function TransactionsPanelClient({ jobId }: Props) {
  const t = useTranslations("billingPage.transactions");
  const router = useRouter();
  const urlSearchParams = useSearchParams();

  const paginated = useProtectedPaginatedQuery(
    api.credits.queries.listTransactionsPaginated,
    { jobId },
    { initialNumItems: 25 },
  );

  const rows = useMemo(
    () => (paginated.results ?? []).map(toViewModel),
    [paginated.results],
  );

  const sort = { field: "date" as const, dir: "desc" as const };
  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const now = useMemo(() => Date.now(), [rows.length]);
  const renderGroups = shouldRenderGroups(sort);
  const partitioned = useMemo(
    () => (renderGroups ? partitionByGroup(rows, now, tz) : null),
    [renderGroups, rows, now, tz],
  );
  const summary = useMemo(() => summarize(rows), [rows]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useTransactionsLoadMore({
    sentinelRef,
    scrollRef: scrollContainerRef,
    status: paginated.status,
    loadMore: paginated.loadMore,
    batchSize: 25,
  });

  const clearJobFilter = () => {
    const next = new URLSearchParams(urlSearchParams.toString());
    next.delete("jobId");
    const qs = next.toString();
    router.replace(`/settings/billing${qs ? `?${qs}` : ""}`);
  };

  const showSkeleton = !paginated.isSettled || paginated.isInitialLoading;
  const isEmpty = !showSkeleton && rows.length === 0;

  return (
    <section
      role="region"
      aria-labelledby="transactions-heading"
      data-transactions-panel=""
      data-transactions-filter={jobId ?? "none"}
      data-transactions-status={paginated.status}
      data-transactions-settled={paginated.isSettled ? "true" : "false"}
      className="flex h-full flex-col rounded-xl border border-border/40 bg-card/90 shadow-sm"
    >
      <TransactionsPanelHeader shownCount={rows.length} summary={summary} />

      {jobId && (
        <div
          className="flex items-center gap-2 border-b border-border/40 px-4 py-2"
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

      <div
        ref={scrollContainerRef}
        data-transactions-list=""
        data-transactions-scroll=""
        className="relative max-h-[60vh] flex-1 overflow-auto [&_[data-txn-row]]:[content-visibility:auto] [&_[data-txn-row]]:[contain-intrinsic-size:0_60px]"
      >
        {showSkeleton ? (
          <TransactionsListSkeleton count={6} />
        ) : isEmpty ? (
          <p
            className="p-6 text-center text-sm text-muted-foreground"
            data-transactions-empty="true"
          >
            {jobId ? t("emptyForJob") : t("empty")}
          </p>
        ) : renderGroups && partitioned ? (
          <GroupedRowList groups={partitioned} />
        ) : (
          <RowList rows={rows} />
        )}
        <div
          ref={sentinelRef}
          aria-hidden="true"
          data-transactions-sentinel=""
        />
        {paginated.status === "LoadingMore" && (
          <p
            className="py-3 text-center text-xs text-muted-foreground"
            data-transactions-loading-more="true"
          >
            {t("loadingMore")}
          </p>
        )}
        {paginated.status === "Exhausted" && rows.length > 0 && (
          <p
            className="py-3 text-center text-[11px] text-muted-foreground/70"
            data-transactions-exhausted="true"
          >
            {t("exhausted")}
          </p>
        )}
      </div>
    </section>
  );
}
