"use client";

import { useState, type ReactNode } from "react";
import { useFormatter } from "next-intl";
import { CheckCircle2, ExternalLink, ReviewQueueIcon, SearchX, Undo2 } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { communityUrl, paperHref, recordHref, useAddedPapers, type AddedState, type Submission } from "@/lib/evidence-libraries/added-papers-mock";
import { StatusChip } from "../configuration/status-chip";
import { LIST_FILTER, ListEmpty, ListLoading } from "../list-controls";
import { CommunityIcon } from "../your-communities";
import type { useMySubmissions } from "./use-my-submissions";
import { LINK } from "./add-papers-dialog";

/** Submissions a page shows. */
const PER_PAGE = 8;
/** A row's height, which every row keeps, so a page holds its height and the pager stays put. */
const ROW_REM = 4;

type Show = "all" | "queued" | "published" | "returned";
const SHOWS: { id: Show; label: string }[] = [
  { id: "all", label: "Every status" },
  { id: "queued", label: "In review queue" },
  { id: "published", label: "Published" },
  { id: "returned", label: "Returned" },
];
const showOf = (state: AddedState): Exclude<Show, "all"> => (state === "queued" ? "queued" : state === "returned" ? "returned" : "published");

/**
 * Every paper you sent to a community, yours or a public one, and where it got to: waiting in its review queue,
 * published, or returned with the reviewer's reason. One you sent and is still waiting can be withdrawn.
 */
export function YourSubmissions({ search, heading, read }: {
  search: string;
  heading: ReactNode;
  /** Read with the page, so the list is there when its tab is picked. */
  read: ReturnType<typeof useMySubmissions>;
}) {
  const format = useFormatter();
  const { submissions, isLoading } = read;
  const withdraw = useAddedPapers((state) => state.withdraw);
  const [show, setShow] = useState<Show>("all");
  const [page, setPage] = useState(1);
  const needle = search.toLowerCase();
  const matching = submissions.filter(
    ({ paper, community }) =>
      (show === "all" || showOf(paper.state) === show) && `${paper.title} ${community.name}`.toLowerCase().includes(needle),
  );
  const pages = Math.max(1, Math.ceil(matching.length / PER_PAGE));
  const shown = Math.min(page, pages);
  const rows = matching.slice((shown - 1) * PER_PAGE, shown * PER_PAGE);
  const counts = Object.fromEntries(SHOWS.map(({ id }) => [id, id === "all" ? submissions.length : submissions.filter(({ paper }) => showOf(paper.state) === id).length]));

  return (
    <section aria-label="Your submissions" className="flex min-w-0 flex-col p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        {heading}
        <Select
          value={show}
          onValueChange={(value) => {
            setShow(value as Show);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" aria-label="Status" className={cn("w-44", LIST_FILTER)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SHOWS.map(({ id, label }) => (
              <SelectItem key={id} value={id}>
                <span className="flex w-full items-center justify-between gap-3">
                  {label}
                  <span className="tabular-nums text-muted-foreground">{counts[id]}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <AutoHeight>
        {isLoading ? (
          <ListLoading label="Reading your submissions" />
        ) : rows.length ? (
          <>
            {/* A full page's height while there are pages, so a short last page keeps the pager where it was. */}
            <ul
              key={`${show}:${needle}:${shown}`}
              className="fade-enter divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle"
              style={pages > 1 ? { minHeight: `calc(${PER_PAGE * ROW_REM}rem + ${PER_PAGE + 1}px)` } : undefined}
            >
              {rows.map((submission) => (
                <SubmissionRow
                  key={`${submission.community.id}:${submission.paper.key}`}
                  submission={submission}
                  date={format.dateTime(submission.paper.addedAt, { day: "numeric", month: "short" })}
                  onWithdraw={() => withdraw(submission.community.id, submission.paper.key)}
                />
              ))}
            </ul>
            {pages > 1 ? (
              <CommandCenterPagination
                className="mt-4"
                currentPage={shown}
                totalPages={pages}
                totalItems={matching.length}
                itemsPerPage={PER_PAGE}
                onPageChange={setPage}
                itemLabel="submissions"
              />
            ) : null}
          </>
        ) : (
          <ListEmpty
            icon={SearchX}
            description={search || show !== "all" ? undefined : "Add a paper to a community from any search result."}
          >
            {search || show !== "all" ? "No submissions match" : "No submissions yet"}
          </ListEmpty>
        )}
      </AutoHeight>
    </section>
  );
}

function SubmissionRow({ submission: { paper, community }, date, onWithdraw }: { submission: Submission; date: string; onWithdraw: () => void }) {
  const state = showOf(paper.state);
  return (
    <li style={{ height: `${ROW_REM}rem` }} className="flex items-center gap-3 px-3">
      <a href={communityUrl(community.address)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${community.name}`} className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CommunityIcon community={{ ...community, role: "viewer" }} fadeIn />
      </a>
      <div className="min-w-0 flex-1">
        <TooltipHint label={paper.title} onlyWhenClipped>
          <a href={paperHref(paper)} className={cn("block truncate text-sm font-medium", LINK)}>{paper.title}</a>
        </TooltipHint>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <TooltipHint label={community.name} onlyWhenClipped>
            <a href={communityUrl(community.address)} target="_blank" rel="noopener noreferrer" className={cn("min-w-0 truncate font-medium text-foreground/80", LINK)}>
              {community.name}
            </a>
          </TooltipHint>
          {state === "returned" && paper.note ? (
            <span className="flex min-w-0 items-center gap-1 ink-warning">
              <Undo2 className="size-3.5 shrink-0" />
              <span className="truncate">{paper.note}</span>
            </span>
          ) : (
            <span className="shrink-0 tabular-nums">{date}</span>
          )}
        </div>
      </div>
      {state === "queued" ? (
        <StatusChip tone="running" icon={ReviewQueueIcon}>In review queue</StatusChip>
      ) : state === "returned" ? (
        <StatusChip tone="warning" icon={Undo2}>Returned</StatusChip>
      ) : (
        <StatusChip tone="success" icon={CheckCircle2}>Published</StatusChip>
      )}
      {/* Every row keeps the action's place, so the chips line up. */}
      <span className="flex w-8 shrink-0 justify-center">
        {state === "queued" ? (
          <TooltipHint label="Withdraw">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Withdraw ${paper.title}`} className="text-muted-foreground hover:text-destructive" onClick={onWithdraw}>
              <Undo2 />
            </Button>
          </TooltipHint>
        ) : state === "published" ? (
          <TooltipHint label={`Open in ${community.name}`}>
            <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
              <a href={recordHref(community.address, paper)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${paper.title} in ${community.name}`}>
                <ExternalLink />
              </a>
            </Button>
          </TooltipHint>
        ) : null}
      </span>
    </li>
  );
}
