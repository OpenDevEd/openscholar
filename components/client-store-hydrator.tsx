// app/providers/ClientStoreHydrator.tsx
"use client";

import React, { useEffect } from "react";
import type { DateRange } from "react-day-picker";
import {
  useRatingsStore,
  useSearchHistoryStore,
  useFocusModeSettingsStore,
  useKeywordExpansionStore,
  useAIConfigStore,
  useUserScreeningQuestionsStore,
  type SearchResult,
  type ScreeningQuestion,
  type ScreeningQuestionType,
} from "@/lib/store";

// Convert server dateRange { from: string|null, to: string|null } to DateRange
function toClientDateRange(
  d: { from?: string | null; to?: string | null } | null | undefined
): DateRange | undefined {
  if (!d) return undefined;
  const from = d.from ? new Date(d.from) : undefined;
  const to = d.to ? new Date(d.to) : undefined;
  if (!from && !to) return undefined;
  return { from, to };
}

function isEmptyObject(obj: Record<string, unknown>) {
  return !obj || Object.keys(obj).length === 0;
}

function isFocusSettingsDefault(s: {
  fontSize: string;
  maxContentWidth: string;
  lineHeight: string;
  showMetadata: boolean;
  compactMode: boolean;
}) {
  return (
    s.fontSize === "base" &&
    s.maxContentWidth === "medium" &&
    s.lineHeight === "normal" &&
    s.showMetadata === true &&
    s.compactMode === false
  );
}

type HydratePayload = Awaited<
  ReturnType<typeof import("@/db/actions").hydrateAll>
>;

type Props = {
  data: HydratePayload;
  children: React.ReactNode;
};

export default function ClientStoreHydrator({ data, children }: Props) {
  useEffect(() => {
    // Avoid double hydration in React Strict Mode (dev) by using a window flag.
    if (typeof window !== "undefined") {
      if ((window as any).__hydratedStores__) return;
      (window as any).__hydratedStores__ = true;
    }

    // 1) Ratings
    if (data.ratings && Array.isArray(data.ratings)) {
      const localRatings = useRatingsStore.getState().ratings;
    //   if (isEmptyObject(localRatings)) {
        const map: Record<string, number> = {};
        for (const r of data.ratings) {
          map[r.paperId] = r.rating;
        }
        useRatingsStore.setState({ ratings: map });
    //   }
    }

    console.log("data.searches", data.searches);
    // 2) Searches (history + related fields)
    if (data.searches && Array.isArray(data.searches)) {
    //   const local = useSearchHistoryStore.getState().searchHistory;
    //   if (!local || local.length === 0) {
    console.log("data.searches", data.searches);
        const mapped: SearchResult[] = data.searches.map((row: any) => ({
          id: row.id,
          query: row.query,
          queryHistory: row.queryHistory || [],
          questionHistory: row.questionHistory || [],
          screeningQuestions: (row.screeningQuestions || []).map((q: any) => ({
            question: q.question,
            locked: !!q.locked,
          })),
          screeningResponses: row.screeningResponses || {},
          count: row.count ?? 0,
          field: row.field,
          dateRange: toClientDateRange(row.dateRange),
          yearRange: row.yearRange ?? undefined,
          filterType: row.filterType ?? undefined,
          isYearRangeEnabled: !!row.isYearRangeEnabled,
          sortBy: row.sortBy ?? undefined,
          selectedRegions: row.selectedRegions ?? undefined,
          selectedCountryFocus: row.selectedCountryFocus ?? undefined,
          ratingRange: row.ratingRange ?? undefined,
          onlyRatedPapers: !!row.onlyRatedPapers,
          citesItemId: row.citesItemId ?? undefined,
          citedByItemId: row.citedByItemId ?? undefined,
          relatedToItemId: row.relatedToItemId ?? undefined,
          reviewFilter: row.reviewFilter ?? undefined,
          language: row.language ?? undefined,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }));
        useSearchHistoryStore.setState({ searchHistory: mapped });
    //   }
    }

    // 3) Focus mode settings
    if (data.focusSettings) {
      const curr = useFocusModeSettingsStore.getState();
      if (
        isFocusSettingsDefault({
          fontSize: curr.fontSize,
          maxContentWidth: curr.maxContentWidth,
          lineHeight: curr.lineHeight,
          showMetadata: curr.showMetadata,
          compactMode: curr.compactMode,
        })
      ) {
        useFocusModeSettingsStore.setState({
          fontSize: (data.focusSettings.fontSize || "base") as
            | "sm"
            | "base"
            | "lg"
            | "xl",
          maxContentWidth: (data.focusSettings.maxContentWidth || "medium") as
            | "narrow"
            | "medium"
            | "wide"
            | "full",
          lineHeight: (data.focusSettings.lineHeight || "normal") as
            | "tight"
            | "normal"
            | "relaxed",
          showMetadata:
            typeof data.focusSettings.showMetadata === "boolean"
              ? data.focusSettings.showMetadata
              : true,
          compactMode:
            typeof data.focusSettings.compactMode === "boolean"
              ? data.focusSettings.compactMode
              : false,
        });
      }
    }

    // 4) Keyword expansion
    if (data.keywords && Array.isArray(data.keywords)) {
    //   const local = useKeywordExpansionStore.getState().keywords;
    //   if (isEmptyObject(local)) {
        const map: Record<string, string> = {};
        for (const k of data.keywords) {
          map[k.shorthand] = k.expansion;
        }
        useKeywordExpansionStore.setState({ keywords: map });
    //   }
    }

    // 5) AI Config (no secrets)
    if (data.aiConfig) {
      const local = useAIConfigStore.getState();
      const isDefault =
        local.provider === "openai" &&
        local.apiKey === "" &&
        local.dollarsUsed === 0 &&
        local.budget === 0;

      if (isDefault) {
        useAIConfigStore.setState({
          provider: (data.aiConfig.provider || "openai") as "openai" | "google",
          apiKey: "", // never hydrate plaintext
          dollarsUsed: parseFloat(data.aiConfig.dollarsUsed || "0") || 0,
          budget: parseFloat(data.aiConfig.budget || "0") || 0,
        });
      }
    }

    // 6) User screening question library
    if (data.userQuestions && Array.isArray(data.userQuestions)) {
    //   const local = useUserScreeningQuestionsStore.getState().userQuestions;
    //   if (!local || local.length === 0) {
        const mapped: ScreeningQuestion[] = data.userQuestions.map(
          (q: any) =>
            ({
              id: q.id,
              key: q.key,
              type: q.type as ScreeningQuestionType,
              question: q.question,
            } as ScreeningQuestion)
        );
        useUserScreeningQuestionsStore.setState({ userQuestions: mapped });
    //   }
    }
  }, [data]);

  return <>{children}</>;
}
