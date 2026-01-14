"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { parseAsInteger, useQueryState } from "nuqs";
import { cn } from "@/lib/utils";
import { useSearchHistoryStore, useUIStore } from "@/lib/store";
import { restoreFromHistory } from "@/lib/search/actions";
import { HistoryHeader } from "./history-header";
import { HistoryToolbar } from "./history-toolbar";
import { HistoryList } from "./history-list";
import { HistoryPagination } from "./history-pagination";
import type { SearchResult } from "@/lib/types";

// Spring animation configs matching sidebar/search-command-center
export const commandCenterSpring = {
  type: "spring" as const,
  stiffness: 500,
  damping: 35,
  mass: 0.8,
};

export const subtleSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
  mass: 0.6,
};

const ITEMS_PER_PAGE = 12;

export function HistoryCommandCenter() {
  const router = useRouter();
  const [searchFilter, setSearchFilter] = useState("");
  const [currentPage, setCurrentPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1)
  );

  const { searchHistory } = useSearchHistoryStore();
  const { historyViewMode, historySortBy } = useUIStore();

  // Filter history based on search input
  const filteredHistory = useMemo(() => {
    if (!searchFilter.trim()) return searchHistory;
    const query = searchFilter.toLowerCase();
    return searchHistory.filter((item) => {
      const matchesQuery = item.query?.toLowerCase().includes(query);
      const matchesQuestion = item.questionHistory?.some((q) =>
        q.question?.toLowerCase().includes(query)
      );
      return matchesQuery || matchesQuestion;
    });
  }, [searchHistory, searchFilter]);

  // Sort history
  const sortedHistory = useMemo(() => {
    const sorted = [...filteredHistory];
    switch (historySortBy) {
      case "oldest":
        return sorted.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      case "most":
        return sorted.sort((a, b) => (b.count || 0) - (a.count || 0));
      case "least":
        return sorted.sort((a, b) => (a.count || 0) - (b.count || 0));
      case "recent":
      default:
        return sorted.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }
  }, [filteredHistory, historySortBy]);

  // Pagination
  const totalPages = Math.ceil(sortedHistory.length / ITEMS_PER_PAGE);
  const paginatedHistory = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedHistory.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedHistory, currentPage]);

  // Reset to page 1 when filter changes
  React.useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages, setCurrentPage]);

  // Handlers
  const handleSearchClick = (item: SearchResult) => {
    router.push(restoreFromHistory(item));
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={subtleSpring}
      className={cn(
        "relative rounded-2xl overflow-hidden",
        "bg-background/80 dark:bg-background/60",
        "backdrop-blur-xl backdrop-saturate-150",
        "border border-border/50",
        "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]"
      )}
    >
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

      {/* Header */}
      <HistoryHeader count={sortedHistory.length} />

      {/* Toolbar */}
      <HistoryToolbar
        searchFilter={searchFilter}
        onSearchChange={setSearchFilter}
        totalCount={searchHistory.length}
      />

      {/* List */}
      <div className="p-4 md:p-6">
        <HistoryList
          items={paginatedHistory}
          viewMode={historyViewMode}
          onSearchClick={handleSearchClick}
          hasFilter={!!searchFilter.trim()}
          onClearFilter={() => setSearchFilter("")}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <HistoryPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            totalItems={sortedHistory.length}
            itemsPerPage={ITEMS_PER_PAGE}
          />
        )}
      </div>
    </motion.div>
  );
}
