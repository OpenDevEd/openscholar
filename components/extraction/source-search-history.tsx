"use client";

import React, { useState, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSearchHistoryStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Loader2,
  FileText,
  Calendar,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

interface SourceSearchHistoryProps {
  analysisId: Id<"analyses">;
  onSuccess?: () => void;
}

export function SourceSearchHistory({
  analysisId,
  onSuccess,
}: SourceSearchHistoryProps) {
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const searchHistory = useSearchHistoryStore((s) => s.searchHistory);
  const importFromSearchHistory = useMutation(
    api.extraction.sources.importFromSearchHistory
  );

  // Filter search history
  const filteredHistory = useMemo(() => {
    if (!searchFilter.trim()) return searchHistory;
    const query = searchFilter.toLowerCase();
    return searchHistory.filter(
      (s) =>
        s.query.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query)
    );
  }, [searchHistory, searchFilter]);

  const handleImport = async () => {
    if (!selectedSearchId) return;

    const selectedSearch = searchHistory.find((s) => s.id === selectedSearchId);
    if (!selectedSearch) return;

    setIsImporting(true);
    try {
      // Fetch papers from OpenAlex for this search
      const response = await fetch(
        `/api/openalex/search?${new URLSearchParams({
          q: selectedSearch.query,
          field: selectedSearch.field,
          per_page: "200", // Limit to 200 papers per import
          ...(selectedSearch.yearRange && {
            from_year: String(selectedSearch.yearRange[0]),
            to_year: String(selectedSearch.yearRange[1]),
          }),
        })}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch papers");
      }

      const data = await response.json();
      const papers = (data.results || []).map((work: any) => ({
        externalId: work.id,
        title: work.title || work.display_name || "Untitled",
        abstract: work.abstract,
        authors: work.authorships?.map(
          (a: any) => a.author?.display_name
        ).filter(Boolean),
        year: work.publication_year,
        doi: work.doi?.replace("https://doi.org/", ""),
        // Extract open access PDF URL if available
        openAccessUrl: work.open_access?.oa_url || work.primary_location?.pdf_url || undefined,
      }));

      if (papers.length === 0) {
        toast.error("No papers found in this search");
        return;
      }

      // Import to Convex
      const result = await importFromSearchHistory({
        analysisId,
        searchId: selectedSearchId,
        searchQuery: selectedSearch.query,
        papers,
      });

      toast.success(`Imported ${result.documentCount} documents`);
      setImportedIds((prev) => new Set([...prev, selectedSearchId]));
      setSelectedSearchId(null);
      onSuccess?.();
    } catch (error: any) {
      console.error("Import failed:", error);
      toast.error(error.message || "Failed to import documents");
    } finally {
      setIsImporting(false);
    }
  };

  const selectedSearch = searchHistory.find((s) => s.id === selectedSearchId);

  return (
    <div className="flex flex-col h-[400px]">
      {/* Search filter */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter search history..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Search list */}
      <ScrollArea className="flex-1 border rounded-lg">
        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-8 w-8 mb-2" />
            <p className="text-sm">No search history found</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filteredHistory.map((search) => {
              const isSelected = selectedSearchId === search.id;
              const isImported = importedIds.has(search.id);

              return (
                <button
                  key={search.id}
                  onClick={() =>
                    !isImported && setSelectedSearchId(isSelected ? null : search.id)
                  }
                  disabled={isImported}
                  className={cn(
                    "w-full text-left p-3 rounded-lg transition-colors",
                    "hover:bg-muted/50",
                    isSelected && "bg-primary/10 border border-primary/30",
                    isImported && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{search.query}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {search.count?.toLocaleString() || 0} papers
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(search.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {isImported && (
                      <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t mt-4">
        <p className="text-sm text-muted-foreground">
          {selectedSearch
            ? `Selected: ${selectedSearch.count?.toLocaleString() || 0} papers`
            : "Select a search to import"}
        </p>
        <Button
          onClick={handleImport}
          disabled={!selectedSearchId || isImporting}
        >
          {isImporting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Import Documents
        </Button>
      </div>
    </div>
  );
}

