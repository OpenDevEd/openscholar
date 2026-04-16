"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { AddToExtractionButton } from "@/components/extraction/add-to-extraction-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchHistoryStore } from "@/lib/store";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
import { getSearchResultsWithFilters } from "@/lib/search-utils";
import type { SearchFilters } from "@/lib/types/search.types";

/** Minimal paper shape needed for the selector. Avoids Work/PaperResult mismatch. */
interface SearchPaper {
  id: string;
  title?: string;
  display_name?: string;
  doi?: string | null;
}

/**
 * Reconstruct SearchFilters from a SearchResult history entry.
 * The search history stores query metadata but not the actual API filter shape,
 * so we rebuild the SearchFilters from the stored fields.
 */
function buildFiltersFromSearchResult(
  search: ReturnType<typeof useSearchHistoryStore.getState>["searchHistory"][number],
): SearchFilters {
  return {
    searchField: search.field,
    sortBy: search.sortBy ?? "relevance_score",
    dateRange: search.dateRange,
    yearRange: search.yearRange,
    filterType: search.filterType ?? "year",
    isYearRangeEnabled: search.isYearRangeEnabled,
    ratingRange: search.ratingRange,
    onlyRatedPapers: search.onlyRatedPapers,
    selectedRegions: search.selectedRegions ?? [],
    selectedCountryFocus: search.selectedCountryFocus ?? [],
    citesItemId: search.citesItemId ?? "",
    citedByItemId: search.citedByItemId ?? "",
    relatedToItemId: search.relatedToItemId ?? "",
    reviewFilter: search.reviewFilter ?? false,
  };
}

export function SearchResultsTab() {
  const t = useTranslations("extraction.selector");
  const searchHistory = useSearchHistoryStore((s) => s.searchHistory);
  const { addToBasket } = useAddToBasket();
  const basketPapers = useExtractionBasketStore((s) => s.papers);

  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [papers, setPapers] = useState<SearchPaper[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isFetching, startTransition] = useTransition();
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handleSearchSelect = useCallback(
    (searchId: string) => {
      setSelectedSearchId(searchId);
      setSelected(new Set());
      setPapers([]);
      setFetchError(null);

      const search = searchHistory.find((s) => s.id === searchId);
      if (!search) return;

      startTransition(async () => {
        try {
          const filters = buildFiltersFromSearchResult(search);
          const result = await getSearchResultsWithFilters({
            query: search.query,
            filters,
          });
          const rawPapers = result.results?.results ?? [];
          setPapers(
            rawPapers.map((p) => ({
              id: p.id,
              title: p.title,
              display_name: p.display_name,
              doi: p.doi,
            })),
          );
        } catch {
          setFetchError("Failed to load search results. Try again.");
          setPapers([]);
        }
      });
    },
    [searchHistory],
  );

  const allSelectableIds = useMemo(() => {
    return papers
      .map((p) => normalizeOpenAlexId(p.id))
      .filter((id): id is string => id !== null && !basketPapers.has(id));
  }, [papers, basketPapers]);

  const allSelected =
    allSelectableIds.length > 0 &&
    allSelectableIds.every((id) => selected.has(id));

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSelectableIds));
    }
  }, [allSelected, allSelectableIds]);

  const handleToggle = useCallback((normalizedId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(normalizedId)) {
        next.delete(normalizedId);
      } else {
        next.add(normalizedId);
      }
      return next;
    });
  }, []);

  const handleAddSelected = useCallback(() => {
    if (papers.length === 0 || selected.size === 0) return;

    const toAdd = papers
      .filter((paper) => {
        const normalized = normalizeOpenAlexId(paper.id);
        return normalized !== null && selected.has(normalized);
      })
      .map((paper) => ({
        rawId: paper.id,
        title: paper.title ?? paper.display_name ?? "",
        doi: paper.doi ?? null,
        source: "search" as const,
      }));

    const result = addToBasket(toAdd);
    setSelected(new Set());

    if (result.dropped > 0) {
      toast.info(
        t("addedWithDropped", {
          added: result.added,
          dropped: result.dropped,
        }),
      );
    } else if (result.added > 0) {
      toast.success(t("addedSuccess", { added: result.added }));
    }
  }, [papers, selected, addToBasket, t]);

  if (searchHistory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <p className="text-sm font-semibold">{t("searchEmpty.heading")}</p>
        <p className="text-sm text-muted-foreground">
          {t("searchEmpty.body")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search picker */}
      <div className="flex items-center gap-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Select
          value={selectedSearchId ?? ""}
          onValueChange={handleSearchSelect}
        >
          <SelectTrigger className="w-full max-w-md">
            <SelectValue placeholder={t("searchPicker.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {searchHistory.map((search) => (
              <SelectItem key={search.id} value={search.id}>
                {search.query} ({search.count} results)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading state */}
      {isFetching && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state */}
      {fetchError && !isFetching && (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-destructive">{fetchError}</p>
        </div>
      )}

      {/* Results list */}
      {!isFetching && papers.length > 0 && (
        <>
          {/* Bulk actions */}
          <div className="flex items-center gap-3">
            <Checkbox
              checked={allSelected}
              onCheckedChange={handleToggleAll}
              aria-label={t("selectAll")}
            />
            <span className="text-sm text-muted-foreground">
              {t("selectAll")}
            </span>
            {selected.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddSelected}
              >
                {t("addSelected")} ({selected.size})
              </Button>
            )}
          </div>

          {/* Paper list */}
          <div className="divide-y">
            {papers.map((paper) => {
              const normalized = normalizeOpenAlexId(paper.id);
              const inBasket = normalized
                ? basketPapers.has(normalized)
                : false;
              const isSelected = normalized
                ? selected.has(normalized)
                : false;

              return (
                <div
                  key={paper.id}
                  className={`flex items-center gap-3 py-3 ${inBasket ? "opacity-60" : ""}`}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() =>
                      normalized && handleToggle(normalized)
                    }
                    disabled={inBasket}
                    aria-label={
                      paper.title ?? paper.display_name ?? "Paper"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {paper.title ?? paper.display_name ?? "Untitled"}
                    </p>
                    {paper.doi && (
                      <p className="text-xs text-muted-foreground truncate">
                        {paper.doi}
                      </p>
                    )}
                  </div>
                  {inBasket ? (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {t("alreadyInBasket")}
                    </span>
                  ) : (
                    <AddToExtractionButton
                      paper={{
                        rawId: paper.id,
                        title:
                          paper.title ?? paper.display_name ?? "Untitled",
                        doi: paper.doi ?? null,
                      }}
                      source="search"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* No results for selected search */}
      {!isFetching &&
        selectedSearchId &&
        papers.length === 0 &&
        !fetchError && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">
              No papers found for this search.
            </p>
          </div>
        )}
    </div>
  );
}
