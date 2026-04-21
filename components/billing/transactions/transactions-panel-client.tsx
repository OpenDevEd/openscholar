"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProtectedPaginatedQuery } from "@/lib/auth/use-auth-query";
import { buildFilterPredicate } from "@/lib/billing/transactions/filters";
import {
  partitionByGroup,
  shouldRenderGroups,
  type GroupKey,
} from "@/lib/billing/transactions/grouping";
import { sortRows } from "@/lib/billing/transactions/sort";
import {
  toViewModel,
  type TransactionViewModel,
} from "@/lib/billing/transactions/transaction-view-model";
import { cn } from "@/lib/utils";

import { TransactionRow } from "./transaction-row";
import {
  TransactionsPanelHeader,
  type TransactionsSummary,
} from "./transactions-panel-header";
import { TransactionsGroupHeader } from "./transactions-group-header";
import { TransactionsListSkeleton } from "./transactions-list-skeleton";
import { TransactionsPanelTabs } from "./transactions-panel-tabs";
import { TransactionsPanelToolbar } from "./transactions-panel-toolbar";
import { useTransactionsLoadMore } from "./use-transactions-load-more";
import {
  useTransactionsState,
  type Density,
} from "./use-transactions-state";

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

function bumpCount(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function RowList({
  rows,
  density,
}: {
  rows: readonly TransactionViewModel[];
  density: Density;
}) {
  return (
    <div role="list" className="divide-y divide-border/40">
      {rows.map((row) => (
        <TransactionRow key={row.id} row={row} density={density} />
      ))}
    </div>
  );
}

function GroupedRowList({
  groups,
  density,
}: {
  groups: ReadonlyArray<readonly [GroupKey, readonly TransactionViewModel[]]>;
  density: Density;
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
          <RowList rows={groupRows} density={density} />
        </section>
      ))}
    </>
  );
}

export function TransactionsPanelClient({ jobId }: Props) {
  const t = useTranslations("billingPage.transactions");
  const router = useRouter();
  const urlSearchParams = useSearchParams();
  const [state] = useTransactionsState();

  const deferredQuery = useDeferredValue(state.q);
  const isSearchStale = deferredQuery !== state.q;

  const paginated = useProtectedPaginatedQuery(
    api.credits.queries.listTransactionsPaginated,
    {
      jobId,
      types: state.types.length > 0 ? state.types : undefined,
      from: state.from ? state.from.getTime() : undefined,
      to: state.to ? state.to.getTime() : undefined,
    },
    { initialNumItems: 25 },
  );

  const baseRows = useMemo(
    () => (paginated.results ?? []).map(toViewModel),
    [paginated.results],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const row of baseRows) {
      bumpCount(c, `type:${row.type}`);
      bumpCount(c, `creditPool:${row.creditType}`);
      if (row.billingType) bumpCount(c, `billingType:${row.billingType}`);
    }
    return c;
  }, [baseRows]);

  const filteredRows = useMemo(() => {
    const predicate = buildFilterPredicate({
      types: state.types,
      creditPools: state.creditPools,
      billingTypes: state.billingTypes,
      dateRange:
        state.from && state.to
          ? { from: state.from.getTime(), to: state.to.getTime() }
          : null,
      search: deferredQuery,
    });
    return baseRows.filter(predicate);
  }, [
    baseRows,
    state.types,
    state.creditPools,
    state.billingTypes,
    state.from,
    state.to,
    deferredQuery,
  ]);

  const rows = useMemo(
    () => sortRows(filteredRows, state.sort, state.sortDir),
    [filteredRows, state.sort, state.sortDir],
  );

  const renderGroups = shouldRenderGroups({
    field: state.sort,
    dir: state.sortDir,
  });
  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const now = useMemo(() => Date.now(), [rows.length]);
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

  const [announcedCount, setAnnouncedCount] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setAnnouncedCount(
        t("live.summary", { shown: rows.length, total: baseRows.length }),
      );
    }, 500);
    return () => clearTimeout(id);
  }, [rows.length, baseRows.length, t]);

  return (
    <section
      role="region"
      aria-labelledby="transactions-heading"
      data-transactions-panel=""
      data-transactions-filter={jobId ?? "none"}
      data-transactions-status={paginated.status}
      data-transactions-settled={paginated.isSettled ? "true" : "false"}
      data-transactions-density={state.density}
      className="flex h-full flex-col rounded-xl border border-border/40 bg-card/90 shadow-sm"
    >
      <TransactionsPanelHeader shownCount={rows.length} summary={summary} />
      <TransactionsPanelTabs />
      <TransactionsPanelToolbar counts={counts} />

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

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-transactions-live-summary
      >
        {announcedCount}
      </p>

      <div
        ref={scrollContainerRef}
        data-transactions-list=""
        data-transactions-scroll=""
        data-search-deferred={isSearchStale ? "true" : "false"}
        aria-busy={isSearchStale ? "true" : "false"}
        className={cn(
          "relative max-h-[60vh] flex-1 overflow-auto",
          "[&_[data-txn-row]]:[content-visibility:auto] [&_[data-txn-row]]:[contain-intrinsic-size:0_60px]",
          isSearchStale && "opacity-70",
        )}
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
          <GroupedRowList groups={partitioned} density={state.density} />
        ) : (
          <RowList rows={rows} density={state.density} />
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
