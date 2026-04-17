"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useSearchHistoryStore } from "@/lib/store";
import { Search, Calendar, FileText } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { SelectableList } from "./bucket/selectable-list";
import { useBucketStore } from "@/lib/store/bucket";
import { fromSavedSearchQuery } from "@/lib/bucket/bucketItem";
import type { SearchResult } from "@/lib/types";

export function HistorySelector() {
  const format = useFormatter();
  const now = useNow();
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const searchHistory = useSearchHistoryStore((state) => state.searchHistory);
  const addMany = useBucketStore((s) => s.addMany);
  const removeMany = useBucketStore((s) => s.removeMany);
  const order = useBucketStore((s) => s.order);
  const bucketKeys = useMemo(() => new Set(order), [order]);

  const isSelected = useMemo(
    () => (entry: SearchResult) => bucketKeys.has(`history:${entry.id}`),
    [bucketKeys],
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

  const toBucketItem = (entry: SearchResult) =>
    fromSavedSearchQuery({
      id: entry.id,
      query: entry.query,
      count: entry.count,
      searchFilters: {
        query: entry.query,
        field: entry.field,
        yearRange: entry.yearRange,
        dateRange: entry.dateRange
          ? {
              from: entry.dateRange.from?.toISOString(),
              to: entry.dateRange.to?.toISOString(),
            }
          : undefined,
        filterType: entry.filterType,
        isYearRangeEnabled: entry.isYearRangeEnabled,
        sortBy: entry.sortBy,
        selectedRegions: entry.selectedRegions,
        selectedCountryFocus: entry.selectedCountryFocus,
        ratingRange: entry.ratingRange,
        onlyRatedPapers: entry.onlyRatedPapers,
        citesItemId: entry.citesItemId,
        citedByItemId: entry.citedByItemId,
        relatedToItemId: entry.relatedToItemId,
        reviewFilter: entry.reviewFilter,
        language: entry.language,
        searchField: entry.field,
      },
    });

  return (
    <SelectableList<SearchResult>
      items={searchHistory}
      keyOf={(e) => e.id}
      isSelected={isSelected}
      onToggle={(entry, next) => {
        const bucketItem = toBucketItem(entry);
        if (next) addMany([bucketItem]);
        else removeMany([bucketItem.bucketKey]);
      }}
      onToggleRange={(entries, next) => {
        const bucketItems = entries.map((e) => toBucketItem(e));
        if (next) addMany(bucketItems);
        else removeMany(bucketItems.map((b) => b.bucketKey));
      }}
      onToggleAll={(next) => {
        const bucketItems = searchHistory.map((e) => toBucketItem(e));
        if (next) addMany(bucketItems);
        else removeMany(bucketItems.map((b) => b.bucketKey));
      }}
      renderRow={(entry) => (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground truncate">
              {entry.query}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>
                {format.relativeTime(new Date(entry.createdAt), now)}
              </span>
            </div>
            <span className="w-1 h-1 rounded-full bg-border" />
            <div className="flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" />
              <span>
                {format.number(entry.count ?? 0)}{" "}
                {tc("results").toLowerCase()}
              </span>
            </div>
          </div>
        </div>
      )}
    />
  );
}
