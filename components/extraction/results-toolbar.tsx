"use client";

import { useCallback, Dispatch, SetStateAction } from "react";
import { Table2, LayoutGrid, PanelLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SearchInput } from "./search-input";
import { ConfidenceFilter } from "./confidence-filter";
import { StatusFilter } from "./status-filter";
import type { FilterState, Question } from "@/lib/extraction/filtering";

interface ResultsToolbarProps {
  filters: FilterState;
  onFiltersChange: Dispatch<SetStateAction<FilterState>>;
  viewMode: 'table' | 'cards' | 'split';
  onViewModeChange: (mode: 'table' | 'cards' | 'split') => void;
  totalCount: number;
  filteredCount: number;
  questions: Question[];
}

export function ResultsToolbar({
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
  totalCount,
  filteredCount,
  questions,
}: ResultsToolbarProps) {
  // Memoize filter change handlers - use functional updates
  const handleSearchChange = useCallback((q: string) => {
    onFiltersChange((prev) => ({ ...prev, searchQuery: q }));
  }, [onFiltersChange]);

  const handleConfidenceChange = useCallback((r: [number, number]) => {
    onFiltersChange((prev) => ({ ...prev, confidenceRange: r }));
  }, [onFiltersChange]);

  const handleStatusChange = useCallback((s: Set<string>) => {
    onFiltersChange((prev) => ({ ...prev, statusFilters: s }));
  }, [onFiltersChange]);

  return (
    <div className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm border-b rounded-t-xl">
      {/* Top row: Search + View Mode */}
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        <SearchInput
          value={filters.searchQuery}
          onChange={handleSearchChange}
          placeholder="Search papers, answers, citations..."
        />
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && onViewModeChange(v as any)}
          className="justify-start"
        >
          <ToggleGroupItem value="table" aria-label="Table view">
            <Table2 className="w-4 h-4 mr-2" />
            Table
          </ToggleGroupItem>
          <ToggleGroupItem value="cards" aria-label="Card view">
            <LayoutGrid className="w-4 h-4 mr-2" />
            Cards
          </ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Split view">
            <PanelLeft className="w-4 h-4 mr-2" />
            Split
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Bottom row: Filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
        <ConfidenceFilter
          range={filters.confidenceRange}
          onChange={handleConfidenceChange}
        />
        <StatusFilter
          selected={filters.statusFilters}
          onChange={handleStatusChange}
        />
        <Badge variant="outline" className="ml-auto">
          {filteredCount} of {totalCount} papers
        </Badge>
      </div>
    </div>
  );
}
