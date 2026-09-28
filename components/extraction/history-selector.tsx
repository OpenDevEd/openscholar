"use client";

import { useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { useSearchHistoryStore } from "@/lib/store";
import { Search, Calendar, FileText } from "lucide-react";
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

const HISTORY_BUCKET_KEY_PREFIX = "history:";

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
  defaultCount,
}: {
  entry: SearchResult;
  cap: number;
  defaultCount: number;
}) {
  const bucketKey = historyBucketKey(entry);
  const paperCount = useBucketStore(
    (s) => s.items[bucketKey]?.paperCount ?? 0,
  );
  return (
    <CountChip
      entry={entry}
      bucketKey={bucketKey}
      paperCount={paperCount}
      cap={cap}
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
  const searchHistory = useSearchHistoryStore((state) => state.searchHistory);
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
  const selectedPaperCount = useBucketStore((s) =>
    searchHistory.reduce((n, entry) => {
      const item = s.items[historyBucketKey(entry)];
      return item ? n + (item.paperCount ?? 0) : n;
    }, 0),
  );
  const selectedEntryCount = useMemo(
    () =>
      searchHistory.filter((e) => bucketKeys.has(historyBucketKey(e))).length,
    [bucketKeys, searchHistory],
  );

  // Clamp the cold-start paperCount down to `pullCap` at selection
  // time so an entry.count of 3000 doesn't immediately blow past the
  // per-row cap before the CountChip has a chance to mount. The chip
  // then refines downward (if fresh count < cap) via its own effect.
  // Null for a saved search whose query is no longer valid; the toast says why.
  const toBucketItem = useCallback(
    (entry: SearchResult) => {
      const searchFilters = paramsToBucketSearchFilters(
        { ...DEFAULT_SEARCH_PARAMS, ...searchResultToParams(entry) },
        {
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
        pullCap,
        Math.max(0, seeded.paperCount ?? pullDefault),
      );
      return { ...seeded, paperCount: initial };
    },
    [pullCap, pullDefault, tv, toast],
  );

  if (searchHistory.length === 0) {
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
    <SelectableList<SearchResult>
      items={searchHistory}
      keyOf={(e) => e.id}
      isSelected={isSelected}
      headerLabel={
        selectedEntryCount > 0
          ? `${format.number(selectedPaperCount)} papers from ${selectedEntryCount} search${selectedEntryCount === 1 ? "" : "es"}`
          : `${searchHistory.length} saved search${searchHistory.length === 1 ? "" : "es"}`
      }
      onToggle={(entry, next) => {
        if (!next) {
          removeMany([historyBucketKey(entry)]);
          return;
        }
        const bucketItem = toBucketItem(entry);
        if (bucketItem) bucketAdded(addMany([bucketItem], limit), { silent: true });
      }}
      onToggleRange={(entries, next) => {
        if (!next) {
          removeMany(entries.map(historyBucketKey));
          return;
        }
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
                  defaultCount={pullDefault}
                />
              </div>
            )}
          </div>
        </div>
      )}
    />
  );
}
