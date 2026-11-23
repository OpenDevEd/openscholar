"use client";

// The list of a workspace's screenings: the ones waiting on you first, then the rest.
// It takes the place of the rail the screening page has today. Placeholder data (./data.ts).

import { useMemo, useState } from "react";
import { MotionConfig } from "motion/react";
import { ChevronRight, GitCompare, ListChecks, Plus } from "@/components/icons";
import { CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { AVATARS_FADE_IN } from "@/components/ui/avatar";
import { Chip } from "@/components/screening/parts";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { pagerOf } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import Link from "@/components/workspace-link";
import { REVIEWERS, MORE_REVIEWERS, SCREENINGS, STAGES, YOU, dealtTo, settle, type Result, type ScreeningRow } from "./data";
import { ResultBar, ReviewerStack } from "./parts";

type Sort = "recent" | "name";
const FINISHED_PAGE = 2;
const ROW = 73;

/** The first screening's numbers come from the same made-up votes its pages show. */
function live(row: ScreeningRow): ScreeningRow {
  if (row.id !== "edtech") return row;
  const { papers, votes, resolved } = STAGES.abstract;
  const settled = settle(papers, votes, resolved);
  const counts: Record<Result, number> = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
  for (const paper of papers) counts[settled[paper.id]!.result]++;
  return { ...row, counts, conflicts: counts.conflict, forYou: papers.filter((paper, index) => dealtTo(index).includes(YOU.id) && !votes[paper.id]?.[YOU.id]).length };
}

export function ScreeningsIndex() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [page, setPage] = useState(1);
  const rows = useMemo(() => {
    const words = search.trim().toLowerCase();
    const found = SCREENINGS.map(live).filter((row) => !words || row.name.toLowerCase().includes(words));
    return sort === "name" ? [...found].sort((a, b) => a.name.localeCompare(b.name)) : found;
  }, [search, sort]);
  const needsYou = rows.filter((row) => !row.finished && (row.forYou || row.conflicts));
  const open = rows.filter((row) => !row.finished && !row.forYou && !row.conflicts);
  const finished = rows.filter((row) => row.finished);
  const pager = pagerOf(finished.length, FINISHED_PAGE, page, setPage);

  return (
    <MotionConfig reducedMotion="user">
      <PageWrapper>
        {/* Faces fade in as they load, where they would otherwise appear in one frame. */}
        <div className={`contents ${AVATARS_FADE_IN}`}>
        <LibraryPageShell
          icon={ListChecks}
          title="Screening"
          filters={
            <CommandCenterFilters
              sortOptions={[{ value: "recent", label: "Recent" }, { value: "name", label: "Name" }]}
              currentSort={sort}
              onSortChange={setSort}
              searchFilter={search}
              onSearchChange={(next) => { setPage(1); setSearch(next); }}
              placeholder="Find a screening"
            />
          }
          actions={
            <Button asChild size="sm" className={BAR_ACTION}>
              <Link href="/screening/mock/new"><Plus /><span className={BAR_LABEL}>New screening</span></Link>
            </Button>
          }
        >
          {rows.length === 0 ? <p className="px-4 py-16 text-center text-sm text-muted-foreground">No screening matches.</p> : null}
          <Group label="Needs you" rows={needsYou} />
          <Group label="In progress" rows={open} />
          {finished.length ? (
            <section>
              <h2 className="border-b border-border-subtle bg-inset px-4 py-2 text-xs font-medium text-muted-foreground sm:px-6">Finished</h2>
              {/* A full page's height, so a short last page doesn't move the pager. */}
              <ul className="divide-y divide-border-subtle" style={{ minHeight: pager.pages > 1 ? FINISHED_PAGE * ROW : undefined }}>
                {finished.slice((pager.page - 1) * FINISHED_PAGE, pager.page * FINISHED_PAGE).map((row) => <Row key={row.id} row={row} />)}
              </ul>
              {pager.pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4" currentPage={pager.page} totalPages={pager.pages} onPageChange={setPage} totalItems={pager.total} itemsPerPage={FINISHED_PAGE} itemLabel="finished screenings" /> : null}
            </section>
          ) : null}
        </LibraryPageShell>
        </div>
      </PageWrapper>
    </MotionConfig>
  );
}

function Group({ label, rows }: { label: string; rows: ScreeningRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="border-b border-border-subtle">
      <h2 className="border-b border-border-subtle bg-inset px-4 py-2 text-xs font-medium text-muted-foreground sm:px-6">{label}</h2>
      <ul className="divide-y divide-border-subtle">{rows.map((row) => <Row key={row.id} row={row} />)}</ul>
    </section>
  );
}

/** A screening: its name, its reviewers, where its papers stand, and what waits on you. */
function Row({ row }: { row: ScreeningRow }) {
  const reviewers = [...REVIEWERS, ...MORE_REVIEWERS].filter((reviewer) => row.reviewers.includes(reviewer.id));
  return (
    <li>
      <Link href={`/screening/mock/${row.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted sm:px-6 @3xl:grid-cols-[minmax(0,1.5fr)_9.5rem_minmax(0,1fr)_17.5rem_1rem]" style={{ minHeight: ROW }}>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{row.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{row.papers.toLocaleString()} papers from {row.sources} {row.sources === 1 ? "source" : "sources"}, updated {row.updated}</span>
        </span>
        <span className="flex justify-end @3xl:justify-start"><ReviewerStack reviewers={reviewers} /></span>
        <span className="col-span-2 @3xl:col-span-1"><ResultBar counts={row.counts} /></span>
        <span className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 @3xl:col-span-1">
          {row.forYou ? <Chip icon={ListChecks} className="bg-primary/12 text-primary">{row.forYou} for you to screen</Chip> : null}
          {row.conflicts ? <Chip icon={GitCompare} className="bg-primary/12 text-primary">{row.conflicts} conflicts</Chip> : null}
          {!row.forYou && !row.conflicts ? <Chip>{row.finished ? `${row.counts.include.toLocaleString()} included` : `${row.counts.waiting.toLocaleString()} waiting for votes`}</Chip> : null}
        </span>
        <ChevronRight className="size-4 text-muted-foreground @max-3xl:hidden" />
      </Link>
    </li>
  );
}
