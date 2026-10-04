"use client";

import React, { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { parseAsInteger, useQueryState } from "nuqs";
import { Database, Plus, ExtractionIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/lib/store";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import type { ExtractionSortBy } from "@/lib/types";
import type { Doc } from "@/convex/_generated/dataModel";
import Link from "next/link";
import {
  CommandCenterList,
  CommandCenterPagination,
} from "@/components/command-center";
import { CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
import { ViewModeSwitch } from "@/components/view-mode-toggle";
import { JobListItem } from "./job-list-item";
import type { ViewMode } from "@/lib/types";

function createExtractionJobListItem(viewMode: ViewMode) {
  return function ExtractionJobListItem({ item }: { item: ExtractionJob }) {
    return <JobListItem job={item} viewMode={viewMode} />;
  };
}

type ExtractionJob = Doc<"extractionJobs">;

interface ExtractionCommandCenterProps {
  /** Undefined while the jobs load: the page and its bar show at once and only the list waits. */
  jobs: ExtractionJob[] | undefined;
}

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  downloading_pdfs: 1,
  extracting: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
};

export function ExtractionCommandCenter({ jobs }: ExtractionCommandCenterProps) {
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
    if (!jobs || !searchFilter.trim()) return jobs ?? [];
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
          (a, b) => (STATUS_ORDER[a.status ?? "pending"] ?? 99) - (STATUS_ORDER[b.status ?? "pending"] ?? 99)
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
    <LibraryPageShell
      icon={ExtractionIcon}
      title={tc("extraction")}
      tabs={<ViewModeSwitch value={extractionViewMode} onChange={setExtractionViewMode} />}
      filters={<CommandCenterFilters
        sortOptions={SORT_OPTIONS}
        currentSort={extractionSortBy}
        onSortChange={setExtractionSortBy}
        searchFilter={searchFilter}
        onSearchChange={setSearchFilter}
        placeholder={t("searchJobs")}
      />}
      actions={
        <Button asChild size="sm" className={BAR_ACTION}>
          <Link href="/extraction/new">
            <Plus />
            <span className={BAR_LABEL}>{tc("new")}</span>
          </Link>
        </Button>
      }
    >
      <div>
        {!jobs ? <ListLoading label={tc("loading")} /> : <CommandCenterList
          items={paginatedJobs}
          viewMode={extractionViewMode}
          keyExtractor={(job) => job._id}
          emptyIcon={Database}
          emptyTitle={t("noExtractionJobs")}
          emptyDescription={t("createJobToStart")}
          hasFilter={!!searchFilter.trim()}
          onClearFilter={() => setSearchFilter("")}
          ItemComponent={createExtractionJobListItem(extractionViewMode)}
        />}

        {/* Pagination */}
        {totalPages > 1 && (
          <CommandCenterPagination
            className="border-t border-border-subtle p-4"
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={sortedJobs.length}
            itemsPerPage={COMMAND_CENTER_ITEMS_PER_PAGE}
            itemLabel={t("jobs")}
          />
        )}
      </div>
    </LibraryPageShell>
  );
}
