"use client";

import { useWaitingInvitations, WaitingInvitations } from "@/components/workspaces/shared";
import { useState } from "react";
import { ItemPresence } from "@/components/workspaces/presence";
import { useTranslations } from "next-intl";
import { Database, Plus, ExtractionIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/lib/store";
import { usePhoneView } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import type { ExtractionSortBy } from "@/lib/types";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import Link from "@/components/workspace-link";
import {
  CommandCenterList,
  CommandCenterPagination,
} from "@/components/command-center";
import { CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListLoading, STALE_ROWS } from "@/components/evidence-libraries/list-controls";
import { ViewModeSwitch } from "@/components/view-mode-toggle";
import { JobListItem } from "./job-list-item";
import type { ViewMode } from "@/lib/types";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import type { FunctionReturnType } from "convex/server";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { useRunBy } from "@/components/workspaces/run-by";

function createExtractionJobListItem(viewMode: ViewMode) {
  return function ExtractionJobListItem({ item }: { item: ExtractionJob }) {
    // In an organization, a member's job shows who ran it in its ring (#656).
    const face = item.by && !item.by.you ? <IdentityAvatar name={item.by.name} imageUrl={item.by.imageUrl} className={viewMode === "list-detail" ? "size-9" : "size-6"} /> : undefined;
    // Who has it open there, read for the row; only its own page joins its room.
    return <JobListItem job={item} viewMode={viewMode} face={face} done={item.done} presence={<ItemPresence kind="extraction" id={item._id} join={false} />} />;
  };
}

type ExtractionJob = FunctionReturnType<typeof api.extraction.queries.listJobs>["page"][number];

export function ExtractionCommandCenter() {
  const workspaceId = useWorkspace();
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
    extractionViewMode: pickedView,
    setExtractionViewMode,
    extractionSortBy,
    setExtractionSortBy,
  } = useUIStore();
  // On a phone or tablet each job is a card of its own: the only view with room for its chips.
  const extractionViewMode = usePhoneView(pickedView, "grid-2");

  // Read a page at a time, sorted and filtered on the server: the page number can't be jumped to, so it stays out of the URL.
  // In an organization, everyone's extractions or one member's (#656).
  const runBy = useRunBy("extractionJobs");
  const jobs = useCursorPageAt("page", api.extraction.queries.listJobs, inWorkspace(workspaceId, { sort: extractionSortBy, ...(text ? { text } : {}), ...(runBy.by ? { by: runBy.by } : {}) }), COMMAND_CENTER_ITEMS_PER_PAGE);
  // A search's matches aren't counted, so its pager shows the page alone; one member's are the count the filter knows.
  const { data: count } = useProtectedQuery(api.extraction.queries.countJobs, inWorkspace(workspaceId, {}));
  const total = text ? undefined : runBy.by ? runBy.countOf(runBy.by) : count;

  const invitations = useWaitingInvitations();
  return (
    <LibraryPageShell
      intro={runBy.filter}
      icon={ExtractionIcon}
      title={tc("extraction")}
      tabs={<ViewModeSwitch value={pickedView} onChange={setExtractionViewMode} />}
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
      {/* Extractions shared with the person that wait for their answer, above their own. */}
      <WaitingInvitations rows={invitations} kind="extraction" text={searchFilter} />
      <div className={cn(jobs.isStale && STALE_ROWS)}>
        {/* The list waits for the invitations above it too, so they never push it down. */}
        {jobs.isLoading || invitations === undefined ? <ListLoading label={tc("loading")} /> : <CommandCenterList
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
            className="border-t border-border-subtle p-4"
            currentPage={jobs.page}
            itemLabel={t("jobs")}
            steps={{
              canPrevious: jobs.canPrevious,
              canNext: jobs.canNext,
              onPrevious: jobs.previous,
              onNext: jobs.next,
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
