"use client";

import { useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { useSearchList } from "@/lib/research/search-list";
import { useResearchStatus } from "@/lib/research/provider";
import { PageStepper } from "@/components/shared/page-stepper";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
import { Search, Calendar, FileText } from "@/components/icons";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { SelectableList } from "./bucket/selectable-list";
import { CountChip } from "./bucket/count-chip";
import { useBucketStore } from "@/lib/store/bucket";
import { fromSavedSearchQuery } from "@/lib/bucket/bucketItem";
import { paramsToBucketSearchFilters } from "@/lib/chat/params-to-bucket-filters";
import { DEFAULT_SEARCH_PARAMS, searchResultToParams } from "@/lib/search-params";
import { useAppToast } from "@/lib/toast";
import { bucketAdded } from "@/lib/toast/bucket";
import type { SearchResult } from "@/lib/types";
import { PAPER_LIMIT, PAPER_PULL_CAP, PAPER_PULL_DEFAULT } from "@/lib/extraction/limits";
import { browserExpand, ensureQueryShortcuts } from "@/lib/keyword-validation-browser";

const HISTORY_BUCKET_KEY_PREFIX = "history:";
/** Saved searches the picker shows at once. */
const PAGE_SIZE = 20;

function historyBucketKey(entry: SearchResult): string {
  return `${HISTORY_BUCKET_KEY_PREFIX}${entry.id}`;
}

/**
 * Per-row CountChip wrapper. Subscribes to only this row's `paperCount`
 * in the bucket store, so editing one row's count doesn't re-render
 * every other selected row's chip.
 */
function HistoryRowChip({
  entry,
  cap,
  limit,
  defaultCount,
}: {
  entry: SearchResult;
  cap: number;
  limit: number;
  defaultCount: number;
}) {
  const bucketKey = historyBucketKey(entry);
  const paperCount = useBucketStore(
    (s) => s.items[bucketKey]?.paperCount ?? 0,
  );
  // The rest of the bucket, counted as the bucket indicator counts it: a row can only take
  // what's left of the job's limit.
  const others = useBucketStore((s) =>
    s.order.reduce((n, k) => {
      const item = s.items[k];
      return k !== bucketKey && item?.status === "ready" ? n + (item.paperCount ?? 1) : n;
    }, 0),
  );
  return (
    <CountChip
      entry={entry}
      bucketKey={bucketKey}
      paperCount={paperCount}
      cap={Math.max(0, Math.min(cap, limit - others))}
      defaultCount={defaultCount}
    />
  );
}

export function HistorySelector({ paperLimit }: { paperLimit?: number }) {
  const format = useFormatter();
  const now = useNow();
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const toast = useAppToast();
  const { ready } = useResearchStatus();
  const searches = useSearchList({ sort: "recent", pageSize: PAGE_SIZE });
  const searchHistory = searches.items;
  const limit = paperLimit ?? PAPER_LIMIT;
  const pullCap = PAPER_PULL_CAP;
  const pullDefault = PAPER_PULL_DEFAULT;
  const addMany = useBucketStore((s) => s.addMany);
  const removeMany = useBucketStore((s) => s.removeMany);
  const order = useBucketStore((s) => s.order);
  const bucketKeys = useMemo(() => new Set(order), [order]);

  const isSelected = useMemo(
    () => (entry: SearchResult) => bucketKeys.has(historyBucketKey(entry)),
    [bucketKeys],
  );

  // Selection summary reads the staged `paperCount` from the bucket
  // store rather than `entry.count` — after P7 the user can adjust each
  // row's pull count via the CountChip, so the header must reflect
  // what will actually be extracted, not the stale saved-search total.
  // It counts from the bucket, since a picked search can sit on another page.
  const selectedPaperCount = useBucketStore((s) =>
    s.order.reduce((n, key) => (key.startsWith(HISTORY_BUCKET_KEY_PREFIX) ? n + (s.items[key]?.paperCount ?? 0) : n), 0),
  );
  const selectedEntryCount = useMemo(
    () => order.filter((key) => key.startsWith(HISTORY_BUCKET_KEY_PREFIX)).length,
    [order],
  );

  // A picked search starts at `pullDefault` papers (fewer if it has fewer), which the
  // CountChip can raise to `pullCap`; the chip refines downward if the fresh count is lower.
  // Null for a saved search whose query is no longer valid; the toast says why.
  const toBucketItem = useCallback(
    (entry: SearchResult) => {
      const searchFilters = paramsToBucketSearchFilters(
        { ...DEFAULT_SEARCH_PARAMS, ...searchResultToParams(entry) },
        {
          expand: browserExpand,
          getMessage: (key, values) => tv(key as "singleCharSearch", values),
          onWarning: (message) => toast.validation.failed(message),
        },
      );
      if (!searchFilters) return null;
      const seeded = fromSavedSearchQuery({
        id: entry.id,
        query: entry.query,
        count: entry.count,
        searchFilters,
      });
      const initial = Math.min(
        pullDefault,
        Math.max(0, seeded.paperCount ?? pullDefault),
      );
      return { ...seeded, paperCount: initial };
    },
    [pullDefault, tv, toast],
  );

  if (!ready || searches.isLoading) return <ListLoading label={tc("loading")} />;

  const savedCount = searches.count ?? searchHistory.length;
  if (searchHistory.length === 0 && !searches.hasPages) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-16 px-4 bg-muted rounded-xl border border-border"
      >
        <Search className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {t("noSearchHistoryFound")}
        </h3>
        <p className="text-muted-foreground">{t("performSearchesFirst")}</p>
      </motion.div>
    );
  }

  return (
    <>
    <SelectableList<SearchResult>
      items={searchHistory}
      keyOf={(e) => e.id}
      isSelected={isSelected}
      headerLabel={
        selectedEntryCount > 0
          ? `${format.number(selectedPaperCount)} papers from ${selectedEntryCount} search${selectedEntryCount === 1 ? "" : "es"}`
          : `${savedCount} saved search${savedCount === 1 ? "" : "es"}`
      }
      onToggle={async (entry, next) => {
        if (!next) {
          removeMany([historyBucketKey(entry)]);
          return;
        }
        await ensureQueryShortcuts(entry.query);
        const bucketItem = toBucketItem(entry);
        if (bucketItem) bucketAdded(addMany([bucketItem], limit), { silent: true });
      }}
      onToggleRange={async (entries, next) => {
        if (!next) {
          removeMany(entries.map(historyBucketKey));
          return;
        }
        await ensureQueryShortcuts(...entries.map((entry) => entry.query));
        bucketAdded(addMany(entries.flatMap((e) => toBucketItem(e) ?? []), limit));
      }}
      renderRow={(entry) => (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground truncate">
              {entry.query}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  {format.relativeTime(new Date(entry.createdAt), now)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                <span>
                  {format.number(entry.count ?? 0)}{" "}
                  {tc("results").toLowerCase()}
                </span>
              </div>
            </div>
            {isSelected(entry) && (
              // Stop click/keyboard propagation so interacting with the
              // chip (opening the popover, picking a preset, typing in
              // the stepper) doesn't bubble up to SelectableList's row
              // onClick/onKeyDown and toggle the row off. Same pattern
              // the checkbox uses in selectable-list.tsx.
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <HistoryRowChip
                  entry={entry}
                  cap={pullCap}
                  limit={limit}
                  defaultCount={pullDefault}
                />
              </div>
            )}
          </div>
        </div>
      )}
    />
    {searches.hasPages && (
      <PageStepper
        className="pt-3"
        page={searches.page}
        pageCount={searches.pageCount}
        canPrevious={searches.canPrevious}
        canNext={searches.canNext}
        onPrevious={searches.previous}
        onNext={searches.next}
      />
    )}
    </>
  );
}
