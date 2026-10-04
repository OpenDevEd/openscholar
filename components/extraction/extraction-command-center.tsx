"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import type { ExtractionSortBy } from "@/lib/types";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
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
  return function ExtractionJobListItem({
    item,
    index,
  }: {
    item: ExtractionJob;
    index: number;
  }) {
    return <JobListItem job={item} viewMode={viewMode} index={index} />;
  };
}

type ExtractionJob = Doc<"extractionJobs">;

export function ExtractionCommandCenter() {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");

  const SORT_OPTIONS: { value: ExtractionSortBy; label: string }[] = [
    { value: "recent", label: tc("recent") },
    { value: "oldest", label: tc("oldest") },
    { value: "name", label: tc("name") },
    { value: "status", label: tc("status") },
  ];
  const [searchFilter, setSearchFilter] = useState("");
  const text = useDebouncedValue(searchFilter.trim(), 300);

  const {
    extractionViewMode,
    setExtractionViewMode,
    extractionSortBy,
    setExtractionSortBy,
  } = useUIStore();

  // Read a page at a time, sorted and filtered on the server: the page number can't be jumped to, so it stays out of the URL.
  const jobs = useCursorPage(api.extraction.queries.listJobs, { sort: extractionSortBy, ...(text ? { text } : {}) }, COMMAND_CENTER_ITEMS_PER_PAGE);
  // A search's matches aren't counted, so its pager shows the page alone.
  const { data: count } = useProtectedQuery(api.extraction.queries.countJobs, {});
  const total = text ? undefined : count;
  const step = (to: () => void) => () => {
    to();
    window.scrollTo({ top: 0 });
  };

  return (
    <LibraryPageShell
      icon={Database}
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
      <div className={cn("p-4 md:p-6", jobs.isStale && "pointer-events-none opacity-60")}>
        {jobs.isLoading ? <ListLoading label={tc("loading")} /> : <CommandCenterList
          items={jobs.items}
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
        {!jobs.isLoading && jobs.hasPages && (
          <CommandCenterPagination
            currentPage={jobs.page}
            itemLabel={t("jobs")}
            steps={{
              canPrevious: jobs.canPrevious,
              canNext: jobs.canNext,
              onPrevious: step(jobs.previous),
              onNext: step(jobs.next),
              offset: jobs.offset,
              shown: jobs.items.length,
              total,
              pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / COMMAND_CENTER_ITEMS_PER_PAGE)),
            }}
          />
        )}
      </div>
    </LibraryPageShell>
  );
}
