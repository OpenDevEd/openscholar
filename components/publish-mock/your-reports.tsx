"use client";

// MOCK (mock/publish-reports): a workspace's reports, where each got to, and a way back into it, listed as History
// and Bookmarks list their entries (components/command-center).

import { useState } from "react";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { LIST_FILTER, ListEmpty } from "@/components/evidence-libraries/list-controls";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { ENTRY_OPEN, Entry, EntryAction } from "@/components/command-center/entry";
import { PaperCover } from "@/components/papers/paper-cover";
import { GRID_CLASSES } from "@/lib/constants/view-modes";
import { REPORT_COVER } from "@/lib/papers/cover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import Link from "@/components/workspace-link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, ArrowUpRight, BadgeCheck, CircleCheck, CircleX, FileText, Hash, PenLine, Plus, ReviewQueueIcon, RotateCcw, Trash2 } from "@/components/icons";
import { standingOf, stepWords } from "@/components/publish-mock/registration";
import { canDiscard, correctionStageOf, coverUrlOf, stageOf, type CorrectionStage, type Settings, type Stage, type Submission } from "@/lib/publish-mock/types";
import { cn } from "@/lib/utils";

const PER_PAGE = 10;
/** A row's height with its divider: its cover and the entry's padding. */
const ROW = 81;
const SHOW_LABEL: Record<Show, string> = { all: "Every status", draft: "Drafts", review: "In review", ready: "Ready to activate", live: "Live", failed: "Failed checks", declined: "Declined" };
const STATUS: Record<Stage, { label: string; tone: "neutral" | "running" | "success" | "danger" | "warning"; icon: typeof PenLine }> = {
  draft: { label: "Draft", tone: "neutral", icon: PenLine },
  review: { label: "In review", tone: "running", icon: ReviewQueueIcon },
  ready: { label: "Ready to activate", tone: "success", icon: CircleCheck },
  live: { label: "Live", tone: "success", icon: BadgeCheck },
  failed: { label: "Failed checks", tone: "danger", icon: CircleX },
  declined: { label: "Declined", tone: "neutral", icon: CircleX },
};
const EMPTY: Record<Show, string> = { all: "No reports yet", draft: "No drafts", review: "No reports in review", ready: "No reports ready to activate", live: "No live reports", failed: "No reports that failed their checks", declined: "No declined reports" };
const CHANGES: Record<CorrectionStage, string> = { review: "Changes in review", failed: "Changes not published", declined: "Changes declined" };
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

export function YourReports({ reports, settings, shared, show, page, onPage, onOpen, onNew, onDiscard, onCorrect }: { reports: Submission[]; settings: Settings; /** An organisation's list: each row says who signed. */ shared: boolean; show: Show; /** The list's page, kept in the address with its filter. */ page: number; onPage: (page: number) => void; onOpen: (id: string) => void; onNew: () => void; onDiscard: (id: string) => Promise<void>; onCorrect: (id: string) => void }) {
  // The report being discarded, asked about once before it goes.
  const [discarding, setDiscarding] = useState<Submission | null>(null);
  const listed = reports.filter((r) => show === "all" || stageOf(r, settings) === show);
  const pages = Math.max(1, Math.ceil(listed.length / PER_PAGE));
  const at = Math.min(page, pages);
  const shown = listed.slice((at - 1) * PER_PAGE, at * PER_PAGE);

  return (
    // The rows run edge to edge in the page's card with a line between them, and the pager closes the card: the
    // layout History, Bookmarks and Extract list with.
    <section aria-label="Your reports">
      {shown.length ? (
        // A list of several pages keeps a full page's height, so its last page doesn't pull the pager up.
        <div className={GRID_CLASSES["list-detail"]} style={pages > 1 ? { minHeight: PER_PAGE * ROW } : undefined}>
          {shown.map((r) => (
            <ReportRow key={r.id} report={r} series={settings.series.name} shared={shared} stage={stageOf(r, settings)} onOpen={() => onOpen(r.id)} onDiscard={canDiscard(r) ? () => setDiscarding(r) : undefined} onCorrect={r.status === "live" ? () => onCorrect(r.id) : undefined} />
          ))}
        </div>
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
          {EMPTY[show]}
        </ListEmpty>
      )}
      {pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4" currentPage={at} totalPages={pages} onPageChange={onPage} totalItems={listed.length} itemsPerPage={PER_PAGE} itemLabel="reports" /> : null}
      <AlertDialog open={!!discarding} onOpenChange={(open) => !open && setDiscarding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this report?</AlertDialogTitle>
            <AlertDialogDescription>Its PDF and its reserved DOI are given up for good. It still counts as one of the reports you started today.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (discarding) void onDiscard(discarding.id);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * One report, as an entry of the app's lists (components/command-center/entry.tsx): its cover, its title, which
 * opens it, its key, date and where it stands, its status, and its actions: discard, correct, and the way in.
 */
function ReportRow({ report: r, series, shared, stage, onOpen, onDiscard, onCorrect }: { report: Submission; series: string; shared: boolean; stage: Stage; onOpen: () => void; onDiscard?: () => void; onCorrect?: () => void }) {
  const status = STATUS[stage];
  const title = r.metadata?.title ?? (r.pdf?.name ? r.pdf.name : "Untitled report");
  // The row's way in, named for what the report needs next.
  const action =
    r.status === "live"
      ? { label: "Open its page", icon: ArrowUpRight }
      : stage === "ready"
        ? { label: "Activate it", icon: ArrowRight }
        : stage === "draft"
          ? { label: "Carry on", icon: ArrowRight }
          : stage === "failed"
            ? { label: "See what failed", icon: RotateCcw }
            : { label: "Open", icon: FileText };
  return (
    <Entry viewMode="list-detail" className="items-center">
      {/* The cover its page wears: the PDF's first page once there is one, the series' title page until then. */}
      <PaperCover className="w-9 shrink-0" {...REPORT_COVER} title={title} authors={[]} source={series} year={null} type="report" image={coverUrlOf(r)} href={null} pdf={false} />
      <div className="min-w-0 flex-1 space-y-1">
        <button type="button" onClick={onOpen} className={cn(ENTRY_OPEN, "block w-full")}>
          <span className="block truncate">{title}</span>
        </button>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-mono">{r.id}</span>
          {shared && r.signedBy?.name ? <span className="shrink-0">{r.signedBy.name}</span> : null}
          <span className="shrink-0 tabular-nums">{day(r.updatedAt)}</span>
          {r.status === "declined" && r.note ? (
            <span className="truncate">{r.note}</span>
          ) : r.status === "live" && r.correction ? (
            // Changes that haven't gone live say where they stand, in place of the registrations.
            <span className="flex min-w-0 items-center gap-1">
              <PenLine className="size-3 shrink-0" />
              <span className="truncate">{CHANGES[correctionStageOf(r, r.correction)]}</span>
            </span>
          ) : r.status === "live" ? (
            <span className="flex min-w-0 items-center gap-1">
              <Hash className="size-3 shrink-0" />
              <span className="truncate">{stepWords(standingOf(r))}</span>
            </span>
          ) : null}
        </div>
      </div>
      {/* Beside the title; on a narrow screen, a line of their own under the text. Every row's actions are there to
          press, each above the row's own hit area: none waits for a pointer. */}
      <div className="flex shrink-0 items-center gap-3 max-sm:basis-full max-sm:justify-between max-sm:ps-12">
        <StatusChip tone={status.tone} icon={status.icon} className="shrink-0">
          {stage === "declined" && r.withdrawnAt ? "Withdrawn" : status.label}
        </StatusChip>
        {/* Room for the two buttons a row can have, so every row's status ends on the same line. */}
        <div className="relative z-10 flex min-w-[4.25rem] items-center justify-end gap-1">
          {onDiscard ? <EntryAction label="Discard" icon={Trash2} danger className="size-8" onClick={onDiscard} /> : null}
          {onCorrect ? <EntryAction label={r.correction ? "See your changes" : "Correct the details"} icon={PenLine} className={cn("size-8", r.correction && "text-primary")} onClick={onCorrect} /> : null}
          {r.status === "live" ? (
            <TooltipHint label={action.label}>
              <Button asChild variant="ghost" size="icon" className="size-8 text-muted-foreground">
                <Link href={`/papers/${r.id}`} aria-label={`${action.label}: ${title}`}>
                  <action.icon className="size-3.5" />
                </Link>
              </Button>
            </TooltipHint>
          ) : (
            <EntryAction label={action.label} icon={action.icon} className="size-8" onClick={onOpen} />
          )}
        </div>
      </div>
    </Entry>
  );
}
