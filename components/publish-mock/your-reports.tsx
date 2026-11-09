"use client";

// MOCK (mock/publish-reports): every report you started, where it got to, and a way back into it. The rows follow Your
// submissions on the Communities page (components/evidence-libraries/added-papers/your-submissions.tsx).

import { useState } from "react";
import Link from "@/components/workspace-link";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { LIST_FILTER, ListEmpty } from "@/components/evidence-libraries/list-controls";
import { Paged, pagerOf } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import { ArrowRight, ArrowUpRight, BadgeCheck, CircleCheck, CircleX, FileText, Hash, PenLine, Plus, ReviewQueueIcon, RotateCcw } from "@/components/icons";
import { standingOf, stepWords } from "@/components/publish-mock/registration";
import { stageOf, type Settings, type Stage, type Submission } from "@/lib/publish-mock/types";
import { cn } from "@/lib/utils";

const PER_PAGE = 8;
/** A row's height with its divider, which every row keeps so a page holds its height. */
const ROW = 65;
const SHOW_LABEL: Record<Show, string> = { all: "Every status", draft: "Drafts", review: "In review", ready: "Ready to activate", live: "Live", failed: "Failed checks", declined: "Declined" };
const STATUS: Record<Stage, { label: string; tone: "neutral" | "running" | "success" | "danger" | "warning"; icon: typeof PenLine }> = {
  draft: { label: "Draft", tone: "neutral", icon: PenLine },
  review: { label: "In review", tone: "running", icon: ReviewQueueIcon },
  ready: { label: "Ready to activate", tone: "success", icon: CircleCheck },
  live: { label: "Live", tone: "success", icon: BadgeCheck },
  failed: { label: "Failed checks", tone: "danger", icon: CircleX },
  declined: { label: "Declined", tone: "neutral", icon: CircleX },
};
const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const SHOWS = ["all", "draft", "review", "ready", "live", "failed", "declined"] as const;
export type Show = (typeof SHOWS)[number];

/** The status filter, which sits in the page's header bar beside the tabs. */
export function StatusFilter({ reports, settings, show, onShow }: { reports: Submission[]; settings: Settings; show: Show; onShow: (show: Show) => void }) {
  const counts = Object.fromEntries(SHOWS.map((s) => [s, s === "all" ? reports.length : reports.filter((r) => stageOf(r, settings) === s).length])) as Record<Show, number>;
  return (
    <Select value={show} onValueChange={(value) => onShow(value as Show)}>
      <SelectTrigger size="sm" aria-label="Status" className={cn("w-44", LIST_FILTER)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {SHOWS.map((id) => (
          <SelectItem key={id} value={id}>
            <span className="flex w-full items-center justify-between gap-3">
              {SHOW_LABEL[id]}
              <span className="tabular-nums text-muted-foreground">{counts[id]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function YourReports({ reports, settings, show, onOpen, onNew }: { reports: Submission[]; settings: Settings; show: Show; onOpen: (id: string) => void; onNew: () => void }) {
  const [page, setPage] = useState(1);
  // A new filter starts at its first page.
  const [shownFor, setShownFor] = useState(show);
  if (shownFor !== show) {
    setShownFor(show);
    setPage(1);
  }
  const listed = reports.filter((r) => show === "all" || stageOf(r, settings) === show);
  const pager = pagerOf(listed.length, PER_PAGE, page, setPage);
  const shown = listed.slice((pager.page - 1) * PER_PAGE, pager.page * PER_PAGE);

  return (
    <section aria-label="Your reports" className="@container/reports p-4 sm:p-6">
      {shown.length ? (
        <Paged pager={pager} rowHeight={ROW} label="reports">
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
            {shown.map((r) => (
              <ReportRow key={r.id} report={r} stage={stageOf(r, settings)} onOpen={() => onOpen(r.id)} />
            ))}
          </ul>
        </Paged>
      ) : (
        <ListEmpty
          icon={FileText}
          description={show === "all" ? "Each report you publish shows here, with where it got to." : undefined}
          action={
            show === "all" ? (
              <Button size="sm" onClick={onNew}>
                <Plus /> Publish a report
              </Button>
            ) : undefined
          }
        >
          {show === "all" ? "No reports yet" : `No reports ${SHOW_LABEL[show].toLowerCase()}`}
        </ListEmpty>
      )}
    </section>
  );
}

/** One report: its title, key and date; the reviewer's note when declined; its status; and the way back into it. */
function ReportRow({ report: r, stage, onOpen }: { report: Submission; stage: Stage; onOpen: () => void }) {
  const status = STATUS[stage];
  const title = r.metadata?.title ?? (r.pdf?.name ? r.pdf.name : "Untitled report");
  const action =
    r.status === "live"
      ? { label: "Open its page", icon: ArrowUpRight }
      : r.status === "failed"
        ? { label: "Upload a new PDF", icon: RotateCcw }
        : r.status === "draft"
          ? { label: "Carry on", icon: ArrowRight }
          : stage === "ready"
            ? { label: "Activate it", icon: ArrowRight }
          : { label: "Open", icon: FileText };
  const open =
    r.status === "live" ? (
      <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
        <Link href={`/papers/${r.id}`} aria-label={`${action.label}: ${title}`}>
          <action.icon />
        </Link>
      </Button>
    ) : (
      <Button variant="ghost" size="icon-sm" aria-label={`${action.label}: ${title}`} className="text-muted-foreground" onClick={onOpen}>
        <action.icon />
      </Button>
    );
  return (
    <li style={{ height: ROW - 1 }} className="flex items-center gap-3 px-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-inset text-muted-foreground">
        <FileText className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <TooltipHint label={title} onlyWhenClipped>
          {r.status === "live" ? (
            <Link href={`/papers/${r.id}`} className="block truncate text-sm font-medium underline-offset-4 hover:underline">
              {title}
            </Link>
          ) : (
            <button type="button" onClick={onOpen} className="block max-w-full truncate text-start text-sm font-medium underline-offset-4 hover:underline">
              {title}
            </button>
          )}
        </TooltipHint>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-mono">{r.id}</span>
          {r.status === "declined" && r.note ? (
            <TooltipHint label={r.note} onlyWhenClipped>
              <span className="truncate">{r.note}</span>
            </TooltipHint>
          ) : (
            <>
              <span className="shrink-0 tabular-nums">{day(r.updatedAt)}</span>
              {r.status === "live" ? (
                <span className="flex min-w-0 items-center gap-1">
                  <Hash className="size-3 shrink-0" />
                  <span className="truncate">{stepWords(standingOf(r))}</span>
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
      <StatusChip tone={status.tone} icon={status.icon} className="hidden shrink-0 @md/reports:inline-flex">
        {status.label}
      </StatusChip>
      <TooltipHint label={action.label}>{open}</TooltipHint>
    </li>
  );
}
