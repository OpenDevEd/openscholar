"use client";

import React, { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { parseAsInteger, useQueryState } from "nuqs";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/lib/store";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import type { ExtractionSortBy } from "@/lib/types";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  CommandCenterToolbar,
  CommandCenterList,
  CommandCenterPagination,
} from "@/components/command-center";
import { JobListItem } from "./job-list-item";

type ExtractionJob = Doc<"extractionJobs">;

interface ExtractionCommandCenterProps {
  jobs: ExtractionJob[];
  onNewJob: () => void;
}

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  downloading_pdfs: 1,
  extracting: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
};

export function ExtractionCommandCenter({ jobs, onNewJob }: ExtractionCommandCenterProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");

  const SORT_OPTIONS: { value: ExtractionSortBy; label: string }[] = [
    { value: "recent", label: tc("recent") },
    { value: "oldest", label: tc("oldest") },
    { value: "name", label: tc("name") },
    { value: "status", label: tc("status") },
  ];
  const [searchFilter, setSearchFilter] = useState("");
  const [currentPage, setCurrentPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({ scroll: true }),
  );

  const {
    extractionViewMode,
    setExtractionViewMode,
    extractionSortBy,
    setExtractionSortBy,
  } = useUIStore();

  // Filter jobs
  const filteredJobs = useMemo(() => {
    if (!searchFilter.trim()) return jobs;
    const query = searchFilter.toLowerCase();
    return jobs.filter(
      (job) =>
        job.name.toLowerCase().includes(query) ||
        (job.description?.toLowerCase().includes(query) ?? false)
    );
  }, [jobs, searchFilter]);

  // Sort jobs
  const sortedJobs = useMemo(() => {
    const sorted = [...filteredJobs];
    switch (extractionSortBy) {
      case "oldest":
        return sorted.sort((a, b) => a.createdAt - b.createdAt);
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "status":
        return sorted.sort(
          (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
        );
      case "recent":
      default:
        return sorted.sort((a, b) => b.createdAt - a.createdAt);
    }
  }, [filteredJobs, extractionSortBy]);

  // Pagination
  const totalPages = Math.ceil(sortedJobs.length / COMMAND_CENTER_ITEMS_PER_PAGE);
  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * COMMAND_CENTER_ITEMS_PER_PAGE;
    return sortedJobs.slice(start, start + COMMAND_CENTER_ITEMS_PER_PAGE);
  }, [sortedJobs, currentPage]);

  // Reset to page 1 when filter changes
  React.useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages, setCurrentPage]);

  return (
    <>
      {/* Toolbar */}
      <CommandCenterToolbar
        viewMode={extractionViewMode}
        onViewModeChange={setExtractionViewMode}
        sortOptions={SORT_OPTIONS}
        currentSort={extractionSortBy}
        onSortChange={setExtractionSortBy}
        searchFilter={searchFilter}
        onSearchChange={setSearchFilter}
        placeholder={t("searchJobs")}
        extraActions={
          <Button size="sm" className="h-9 gap-1.5" onClick={onNewJob}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tc("new")}</span>
          </Button>
        }
      />

      {/* List */}
      <div className="p-4 md:p-6">
        <CommandCenterList
          items={paginatedJobs}
          viewMode={extractionViewMode}
          keyExtractor={(job) => job._id}
          emptyIcon={Database}
          emptyTitle={t("noExtractionJobs")}
          emptyDescription={t("createJobToStart")}
          hasFilter={!!searchFilter.trim()}
          onClearFilter={() => setSearchFilter("")}
          renderItem={(job, index) => (
            <JobListItem
              job={job}
              viewMode={extractionViewMode}
              index={index}
            />
          )}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <CommandCenterPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={sortedJobs.length}
            itemsPerPage={COMMAND_CENTER_ITEMS_PER_PAGE}
            itemLabel={t("jobs")}
          />
        )}
      </div>
    </>
  );
}
