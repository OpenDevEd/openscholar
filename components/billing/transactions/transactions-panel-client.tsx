"use client";

/**
 * TransactionsPanelClient — client-owned billing-transactions surface.
 *
 * Canonical reference:
 *   plans/billing-transactions-redesign/06-polish-a11y-tests.md
 *
 * Tests assert on the `data-*` attributes below, never on CSS classes.
 * Renaming or removing any of these is a breaking change for the test
 * suite and for downstream automation (axe matrix, Playwright specs).
 *
 * ── Panel / region ────────────────────────────────────────────────
 *   [data-transactions-panel]
 *   [data-transactions-filter = jobId | "none"]
 *   [data-transactions-status = "LoadingFirstPage" | "CanLoadMore"
 *                             | "LoadingMore" | "Exhausted" | "Deferred"]
 *   [data-transactions-settled = "true" | "false"]
 *   [data-transactions-density = "compact" | "comfortable" | "spacious"]
 *   [data-transactions-filter-active = "true" | "false"]   (toolbar-scoped)
 *   [data-transactions-scope = "job"]                      (job-scope bar)
 *
 * ── Scroll container / list ───────────────────────────────────────
 *   [data-transactions-list]
 *   [data-transactions-scroll]
 *   [data-search-deferred = "true" | "false"]
 *   aria-activedescendant = "txn-row-<id>"    (keyboard-active row)
 *
 * ── Header + summary ──────────────────────────────────────────────
 *   [data-transactions-header]
 *   [data-transactions-summary]
 *   [data-transactions-shown]  [data-transactions-in]
 *   [data-transactions-out]    [data-transactions-net]
 *   [data-transactions-progress = 0–100]
 *
 * ── Tabs / toolbar ────────────────────────────────────────────────
 *   [data-transactions-tabs]
 *   [data-transactions-tab = "all" | "purchases" | "usage"
 *                          | "refunds-grants" | "failed"]
 *   [data-transactions-toolbar]
 *   [data-transactions-search]        [data-transactions-search-clear]
 *   [data-transactions-clear-all]
 *   [data-transactions-sort-trigger]  [data-sort-field] [data-sort-dir]
 *   [data-sort-option]                [data-sort-dir-option]
 *   [data-transactions-density-trigger] [data-density] [data-density-option]
 *   [data-transactions-date-range]    [data-transactions-date-presets]
 *
 * ── Grouping / group headers ──────────────────────────────────────
 *   [data-transactions-group       = GroupKey]
 *   [data-transactions-group-header = GroupKey]
 *
 * ── Rows ──────────────────────────────────────────────────────────
 *   [data-txn-row]            [data-txn-id]           [data-txn-type]
 *   [data-txn-direction]      [data-txn-credit-type]  [data-txn-billing-type]
 *   [data-txn-status]         [data-txn-density]      [data-txn-active]
 *   [data-txn-amount]         [data-txn-icon]         [data-txn-status-pill]
 *
 * ── Load / state markers ──────────────────────────────────────────
 *   [data-transactions-skeleton] [data-transactions-skeleton-count]
 *   [data-txn-row-skeleton]
 *   [data-transactions-sentinel] [data-transactions-loading-more]
 *   [data-transactions-exhausted]
 *   [data-transactions-empty = "no-data" | "no-matches"]
 *   [data-transactions-empty-clear]
 *   [data-transactions-error]  [data-transactions-error-retry]
 *   [data-transactions-live-summary]
 *
 * ── Export menu ───────────────────────────────────────────────────
 *   [data-transactions-export-trigger] [data-transactions-export-loading]
 *   [data-export-mode = "current" | "all"]
 *
 * ── Detail drawer ─────────────────────────────────────────────────
 *   [data-transaction-drawer]   [data-transaction-id]
 *   [data-drawer-close]         [data-drawer-body]
 *   [data-drawer-section = "amount" | "badges" | "linked"
 *                        | "stripe" | "metadata"]
 *   [data-drawer-amount] [data-direction]
 *   [data-drawer-badge  = "credit-pool" | "billing-type" | "type"]
 *   [data-drawer-link]  [data-drawer-link-state]
 *   [data-drawer-metadata-toggle] [data-metadata-key]
 *   [data-drawer-receipt-download]
 *
 * ── Keyboard contract (use-transactions-keyboard.ts) ──────────────
 *   /              focus search input
 *   ArrowUp/Down   move the active row; scrollIntoView nearest
 *   Enter          open the detail drawer for the active row
 *   Escape         close drawer → clear search → blur search
 *   Cmd/Ctrl + E   open the export menu
 *
 * Invariants:
 *   - `aria-live` is applied to the live-summary paragraph ONLY — never
 *     to the list or any row.
 *   - `activeId` resets to null whenever the row set changes (filter,
 *     sort, pagination drop the active row).
 *   - Global keydown listener does NOT intercept keys while the user is
 *     typing in an input or textarea (guarded by isTextInputTarget).
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useProtectedPaginatedQuery,
  useProtectedQuery,
} from "@/lib/auth/use-auth-query";
import { createEnrichmentCache } from "@/lib/billing/transactions/enrichment-cache";
import { buildFilterPredicate, isFilterActive } from "@/lib/billing/transactions/filters";
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
import { TransactionsExportMenu } from "./transactions-export-menu";
import { TransactionsEmptyState } from "./transactions-empty-state";
import { TransactionsErrorBoundary } from "./transactions-error-boundary";
import { useTransactionsKeyboard } from "./use-transactions-keyboard";
import { useTransactionsLoadMore } from "./use-transactions-load-more";
import {
  useTransactionsState,
  type Density,
} from "./use-transactions-state";

const TransactionDetailDrawer = dynamic(
  () =>
    import("./transaction-detail-drawer").then(
      (m) => m.TransactionDetailDrawer,
    ),
  { ssr: false },
);

const EXPORT_PAGE_SIZE = 500;

type ListTransactionsPage = FunctionReturnType<
  typeof api.credits.queries.listTransactionsPaginated
>;
type ListTransactionsRawPage = FunctionReturnType<
  typeof api.credits.queries.listTransactionsPaginatedRaw
>;

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

function foldFacetCounts(
  facet: { type: Record<string, number>; creditPool: Record<string, number>; billingType: Record<string, number> } | null | undefined,
): Record<string, number> {
  if (!facet) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(facet.type)) out[`type:${k}`] = v;
  for (const [k, v] of Object.entries(facet.creditPool)) out[`creditPool:${k}`] = v;
  for (const [k, v] of Object.entries(facet.billingType)) out[`billingType:${k}`] = v;
  return out;
}

function RowList({
  rows,
  density,
  activeId,
  onRowClick,
}: {
  rows: readonly TransactionViewModel[];
  density: Density;
  activeId: string | null;
  onRowClick: (row: TransactionViewModel) => void;
}) {
  return (
    <div role="presentation" className="divide-y divide-border/40">
      {rows.map((row) => (
        <TransactionRow
          key={row.id}
          row={row}
          density={density}
          isActive={row.id === activeId}
          onClick={onRowClick}
        />
      ))}
    </div>
  );
}

function GroupedRowList({
  groups,
  density,
  activeId,
  onRowClick,
}: {
  groups: ReadonlyArray<readonly [GroupKey, readonly TransactionViewModel[]]>;
  density: Density;
  activeId: string | null;
  onRowClick: (row: TransactionViewModel) => void;
}) {
  return (
    <>
      {groups.map(([groupKey, groupRows]) => (
        <div
          key={groupKey}
          role="presentation"
          data-transactions-group={groupKey}
        >
          <TransactionsGroupHeader groupKey={groupKey} />
          <RowList
            rows={groupRows}
            density={density}
            activeId={activeId}
            onRowClick={onRowClick}
          />
        </div>
      ))}
    </>
  );
}

export function TransactionsPanelClient({ jobId }: Props) {
  return (
    <TransactionsErrorBoundary>
      <TransactionsPanelClientInner jobId={jobId} />
    </TransactionsErrorBoundary>
  );
}

function TransactionsPanelClientInner({ jobId }: Props) {
  const t = useTranslations("billingPage.transactions");
  const router = useRouter();
  const urlSearchParams = useSearchParams();
  const convex = useConvex();
  const [state, setState] = useTransactionsState();

  const deferredQuery = useDeferredValue(state.q);
  const isSearchStale = deferredQuery !== state.q;

  const [detailRow, setDetailRow] = useState<TransactionViewModel | null>(null);
  const triggerIdRef = useRef<string | null>(null);

  const handleRowClick = useCallback((row: TransactionViewModel) => {
    triggerIdRef.current = row.id;
    setDetailRow(row);
  }, []);

  const handleDrawerOpenChange = useCallback((open: boolean) => {
    if (open) return;
    setDetailRow(null);
    const id = triggerIdRef.current;
    triggerIdRef.current = null;
    if (!id) return;
    queueMicrotask(() => {
      const el = document.getElementById(`txn-row-${id}`);
      el?.focus();
    });
  }, []);

  const fetchAll = useCallback(
    async (opts?: {
      signal?: AbortSignal;
      applyCurrentFilters?: boolean;
    }): Promise<TransactionViewModel[]> => {
      const cache = createEnrichmentCache();
      const collected: TransactionViewModel[] = [];
      const applyFilters = opts?.applyCurrentFilters ?? false;
      const filterArgs = applyFilters
        ? {
            jobId,
            types: state.types.length > 0 ? state.types : undefined,
            creditPools:
              state.creditPools.length > 0 ? state.creditPools : undefined,
            billingTypes:
              state.billingTypes.length > 0 ? state.billingTypes : undefined,
            q: deferredQuery.trim().length > 0 ? deferredQuery.trim() : undefined,
            from: state.from ? state.from.getTime() : undefined,
            to: state.to ? state.to.getTime() : undefined,
          }
        : { jobId };

      let cursor: string | null = null;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (opts?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const page: ListTransactionsRawPage = await convex.query(
          api.credits.queries.listTransactionsPaginatedRaw,
          {
            paginationOpts: { numItems: EXPORT_PAGE_SIZE, cursor },
            ...filterArgs,
          },
        );

        // Pull out ids we haven't resolved yet on this run.
        const paperIdsOnPage = new Set<Id<"extractionPapers">>();
        const openalexIdsOnPage = new Set<string>();
        const jobIdsOnPage = new Set<Id<"extractionJobs">>();
        for (const row of page.page) {
          if (row.paperId) paperIdsOnPage.add(row.paperId);
          else {
            const openalexId = row.metadata?.openalexId;
            if (openalexId) openalexIdsOnPage.add(openalexId);
          }
          if (row.jobId) jobIdsOnPage.add(row.jobId);
        }
        const unresolved = cache.selectUnresolved({
          paperIds: paperIdsOnPage,
          openalexIds: openalexIdsOnPage,
          jobIds: jobIdsOnPage,
        });

        if (
          unresolved.paperIds.length > 0 ||
          unresolved.openalexIds.length > 0 ||
          unresolved.jobIds.length > 0
        ) {
          if (opts?.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const resolved = await convex.query(
            api.credits.queries.resolveTransactionEnrichments,
            unresolved,
          );
          for (const id of unresolved.paperIds) {
            const title = resolved.paperTitleById[id];
            if (title !== undefined) cache.recordPaperResolved(id, title);
            else cache.recordPaperNotFound(id);
          }
          for (const oid of unresolved.openalexIds) {
            const title = resolved.paperTitleByOpenalex[oid];
            if (title !== undefined)
              cache.recordPaperByOpenalexResolved(oid, title);
            else cache.recordPaperByOpenalexNotFound(oid);
          }
          for (const id of unresolved.jobIds) {
            const name = resolved.jobNameById[id];
            if (name !== undefined) cache.recordJobResolved(id, name);
            else cache.recordJobNotFound(id);
          }
        }

        for (const doc of page.page) {
          const paperTitle =
            (doc.paperId ? cache.getPaperTitle(doc.paperId) : null) ??
            (doc.metadata?.openalexId
              ? cache.getPaperTitleByOpenalex(doc.metadata.openalexId)
              : null) ??
            null;
          const jobName = doc.jobId ? (cache.getJobName(doc.jobId) ?? null) : null;
          collected.push(toViewModel({ ...doc, paperTitle, jobName }));
        }

        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      return collected;
    },
    [convex, jobId, state, deferredQuery],
  );

  const paginated = useProtectedPaginatedQuery(
    api.credits.queries.listTransactionsPaginated,
    {
      jobId,
      types: state.types.length > 0 ? state.types : undefined,
      creditPools: state.creditPools.length > 0 ? state.creditPools : undefined,
      billingTypes: state.billingTypes.length > 0 ? state.billingTypes : undefined,
      q: deferredQuery.trim().length > 0 ? deferredQuery.trim() : undefined,
      from: state.from ? state.from.getTime() : undefined,
      to: state.to ? state.to.getTime() : undefined,
    },
    { initialNumItems: 25 },
  );

  const baseRows = useMemo(
    () => (paginated.results ?? []).map(toViewModel),
    [paginated.results],
  );

  const facetCounts = useProtectedQuery(
    api.credits.queries.getTransactionFacetCounts,
    {
      from: state.from ? state.from.getTime() : undefined,
      to: state.to ? state.to.getTime() : undefined,
    },
  );

  const counts = useMemo(
    () => foldFacetCounts(facetCounts.data),
    [facetCounts.data],
  );

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
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);

  useTransactionsLoadMore({
    sentinelRef,
    scrollRef: scrollContainerRef,
    status: paginated.status,
    loadMore: paginated.loadMore,
    batchSize: 25,
  });

  const clearAllFilters = useCallback(() => {
    void setState({
      q: "",
      types: [],
      creditPools: [],
      billingTypes: [],
      from: null,
      to: null,
      view: "all",
    });
  }, [setState]);

  const clearSearch = useCallback(() => {
    void setState({ q: "" });
  }, [setState]);

  const openExport = useCallback(() => {
    exportTriggerRef.current?.click();
  }, []);

  const { activeId } = useTransactionsKeyboard({
    rows,
    listRef,
    searchRef,
    onActivateRow: (id) => {
      const row = rows.find((r) => r.id === id);
      if (row) handleRowClick(row);
    },
    onClearSearch: clearSearch,
    onOpenExport: openExport,
    isDrawerOpen: detailRow != null,
    onCloseDrawer: () => setDetailRow(null),
  });

  const clearJobFilter = () => {
    const next = new URLSearchParams(urlSearchParams.toString());
    next.delete("jobId");
    const qs = next.toString();
    router.replace(`/settings/billing${qs ? `?${qs}` : ""}`);
  };

  const showSkeleton = !paginated.isSettled || paginated.isInitialLoading;
  const isEmpty = !showSkeleton && rows.length === 0;
  const filterActive = isFilterActive({
    types: state.types,
    creditPools: state.creditPools,
    billingTypes: state.billingTypes,
    dateRange:
      state.from && state.to
        ? { from: state.from.getTime(), to: state.to.getTime() }
        : null,
    search: state.q,
  });
  const hasJobScope = jobId != null;
  const emptyKind: "no-data" | "no-matches" =
    filterActive || hasJobScope || baseRows.length > 0 ? "no-matches" : "no-data";

  const [announcedCount, setAnnouncedCount] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setAnnouncedCount(
        t("live.summary", { shown: rows.length, total: baseRows.length }),
      );
    }, 500);
    return () => clearTimeout(id);
  }, [rows.length, baseRows.length, t]);

  const handleClearEmpty = useCallback(() => {
    if (hasJobScope) {
      clearJobFilter();
    } else {
      clearAllFilters();
    }
  }, [clearAllFilters, hasJobScope, clearJobFilter]);

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
      <TransactionsPanelHeader
        shownCount={rows.length}
        summary={summary}
        exportSlot={
          <TransactionsExportMenu
            currentView={rows}
            fetchAll={fetchAll}
            triggerRef={exportTriggerRef}
          />
        }
      />
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
        data-transactions-scroll=""
        className={cn(
          "relative max-h-[60vh] flex-1 overflow-auto",
          isSearchStale && "opacity-70",
        )}
      >
        <div
          ref={listRef}
          role="list"
          tabIndex={0}
          aria-activedescendant={activeId ? `txn-row-${activeId}` : undefined}
          data-transactions-list=""
          data-search-deferred={isSearchStale ? "true" : "false"}
          aria-busy={isSearchStale ? "true" : "false"}
          className={cn(
            "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            "[&_[data-txn-row]]:[content-visibility:auto] [&_[data-txn-row]]:[contain-intrinsic-size:0_60px]",
          )}
        >
          {showSkeleton ? (
            <TransactionsListSkeleton count={6} />
          ) : isEmpty ? (
            <TransactionsEmptyState
              kind={emptyKind}
              onClearFilters={
                emptyKind === "no-matches" ? handleClearEmpty : undefined
              }
            />
          ) : renderGroups && partitioned ? (
            <GroupedRowList
              groups={partitioned}
              density={state.density}
              activeId={activeId}
              onRowClick={handleRowClick}
            />
          ) : (
            <RowList
              rows={rows}
              density={state.density}
              activeId={activeId}
              onRowClick={handleRowClick}
            />
          )}
        </div>
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

      <TransactionDetailDrawer
        row={detailRow}
        onOpenChange={handleDrawerOpenChange}
      />
    </section>
  );
}
