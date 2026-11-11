"use client";

// A workspace's reports, where each got to, and a way back into it, listed as History and Bookmarks list their
// entries (components/command-center). The list is read a page at a time (convex/reports/flow.ts `page`).

import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
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
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { standingOf, useStepWords } from "@/components/reports/registration";
import { REPORTS_PER_PAGE, STAGES, canDiscard, stageOf, type Stage } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

type Listed = FunctionReturnType<typeof api.reports.flow.page>;
export type ReportRow = Listed["rows"][number];
export type Counts = FunctionReturnType<typeof api.reports.flow.counts>;
/** A row's height with its divider: its cover and the entry's padding. */
const ROW = 81;
export const STATUS: Record<Stage, { tone: "neutral" | "running" | "success" | "danger" | "warning"; icon: typeof PenLine }> = {
  draft: { tone: "neutral", icon: PenLine },
  review: { tone: "running", icon: ReviewQueueIcon },
  ready: { tone: "success", icon: CircleCheck },
  live: { tone: "success", icon: BadgeCheck },
  failed: { tone: "danger", icon: CircleX },
  declined: { tone: "neutral", icon: CircleX },
};

/** A stage's name; a declined report that was live is named withdrawn. */
export function useStageLabel() {
  const t = useTranslations("publishReports.stages");
  return (stage: Stage, withdrawn = false) => t(stage === "declined" && withdrawn ? "withdrawn" : stage);
}

export const SHOWS = ["all", "draft", "review", "ready", "live", "failed", "declined"] as const satisfies ReadonlyArray<"all" | Stage>;
export type Show = (typeof SHOWS)[number];
/** The stage a filter keeps, as the list's query takes it: none for every status. */
export const stageShown = (show: Show) => (show === "all" ? undefined : STAGES.find((stage) => stage === show));

/** The status filter, which sits in the page's header bar beside the tabs. */
export function StatusFilter({ counts, show, onShow }: { counts: Counts; show: Show; onShow: (show: Show) => void }) {
  const t = useTranslations("publishReports.list");
  return (
    <Select value={show} onValueChange={(value) => onShow(value as Show)}>
      <SelectTrigger size="sm" aria-label={t("status")} className={cn("w-44", LIST_FILTER)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {SHOWS.map((id) => (
          <SelectItem key={id} value={id}>
            <span className="flex w-full items-center justify-between gap-3">
              {t(`show.${id}`)}
              <span className="tabular-nums text-muted-foreground">{counts[id]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function YourReports({ list, humanReview, series, shared, show, onPage, onOpen, onNew, onDiscard, onCorrect }: { list: Listed; humanReview: boolean; /** The series' name, which a report without a cover wears on its title page. */ series: string; /** An organisation's list: each row says who signed. */ shared: boolean; show: Show; onPage: (page: number) => void; onOpen: (key: string) => void; /** None while publishing is off: nothing offers to start a report. */ onNew?: () => void; onDiscard: (key: string) => Promise<void>; onCorrect: (key: string) => void }) {
  // The report being discarded, asked about once before it goes.
  const [discarding, setDiscarding] = useState<ReportRow | null>(null);
  // The button that asked, so the keyboard is back on it when the question closes: the dialog has no trigger of its own.
  const asker = useRef<HTMLElement | null>(null);
  const { rows: shown, page: at, pages, total } = list;
  const t = useTranslations("publishReports.list");

  return (
    // The rows run edge to edge in the page's card with a line between them, and the pager closes the card: the
    // layout History, Bookmarks and Extract list with.
    <section aria-label={t("yourReports")}>
      {shown.length ? (
        // A list of several pages keeps a full page's height, so its last page doesn't pull the pager up. A short one
        // keeps the height of the loading frame it replaces (list-controls' LIST_STATE), so the card doesn't shrink under it.
        <div className={cn(GRID_CLASSES["list-detail"], "min-h-52")} style={pages > 1 ? { minHeight: REPORTS_PER_PAGE * ROW } : undefined}>
          {shown.map((r) => (
            <Row key={r.key} report={r} series={series} shared={shared} stage={stageOf(r, humanReview)} onOpen={() => onOpen(r.key)} onDiscard={
                canDiscard(r) && r.mine
                  ? () => {
                      asker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                      setDiscarding(r);
                    }
                  : undefined
              } onCorrect={r.status === "live" && r.mine ? () => onCorrect(r.key) : undefined} />
          ))}
        </div>
      ) : (
        <ListEmpty
          icon={FileText}
          description={show === "all" ? t("emptyHint") : undefined}
          action={
            show === "all" && onNew ? (
              <Button size="sm" onClick={onNew}>
                <Plus /> {t("publishReport")}
              </Button>
            ) : undefined
          }
        >
          {t(`empty.${show}`)}
        </ListEmpty>
      )}
      {pages > 1 ? <CommandCenterPagination className="border-t border-border-subtle p-4" currentPage={at} totalPages={pages} onPageChange={onPage} totalItems={total} itemsPerPage={REPORTS_PER_PAGE} itemLabel={t("pagerItems")} /> : null}
      <AlertDialog open={!!discarding} onOpenChange={(open) => !open && setDiscarding(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Kept, the row is still there to go back to; discarded, it isn't, and focus goes where the browser puts it.
            if (!asker.current?.isConnected) return;
            event.preventDefault();
            asker.current.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("discardBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (discarding) void onDiscard(discarding.key);
              }}
            >
              {t("discard")}
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
function Row({ report: r, series, shared, stage, onOpen, onDiscard, onCorrect }: { report: ReportRow; series: string; shared: boolean; stage: Stage; onOpen: () => void; onDiscard?: () => void; onCorrect?: () => void }) {
  const t = useTranslations("publishReports.list");
  const format = useFormatter();
  const stepWords = useStepWords();
  const stageLabel = useStageLabel();
  const status = STATUS[stage];
  const title = r.title ?? t("untitled");
  /** The person sees this report and can't change it: its way in only opens it. */
  const watching = !r.mine;
  // The row's way in, named for what the report needs next.
  const action =
    r.status === "live"
      ? { label: t("action.openPage"), icon: ArrowUpRight }
      : watching
        ? { label: t("action.open"), icon: FileText }
      : stage === "ready"
        ? { label: t("action.activate"), icon: ArrowRight }
        : stage === "draft"
          ? { label: t("action.carryOn"), icon: ArrowRight }
          : stage === "failed"
            ? { label: t("action.seeFailed"), icon: RotateCcw }
            : { label: t("action.open"), icon: FileText };
  return (
    <Entry viewMode="list-detail" className="items-center">
      {/* The cover its page wears: the PDF's first page once there is one, the series' title page until then. */}
      <PaperCover className="w-9 shrink-0" {...REPORT_COVER} title={title} authors={[]} source={series} year={null} type="report" image={r.coverUrl} href={null} pdf={false} />
      <div className="min-w-0 flex-1 space-y-1">
        <button type="button" onClick={onOpen} className={cn(ENTRY_OPEN, "block w-full")}>
          <span className="block truncate">{title}</span>
        </button>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-mono">{r.key}</span>
          {shared && r.signer ? <span className="shrink-0">{r.signer}</span> : null}
          <span className="shrink-0 tabular-nums">{format.dateTime(r.updatedAt, { day: "numeric", month: "short", year: "numeric" })}</span>
          {r.status === "declined" && r.note ? (
            <span className="truncate">{r.note}</span>
          ) : r.status === "live" && r.changes ? (
            // Changes that haven't gone live say where they stand, in place of the registrations.
            <span className="flex min-w-0 items-center gap-1">
              <PenLine className="size-3 shrink-0" />
              <span className="truncate">{t(`changes.${r.changes}`)}</span>
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
          {stageLabel(stage, r.withdrawn)}
        </StatusChip>
        {/* Room for the two buttons a row can have, so every row's status ends on the same line. */}
        <div className="relative z-10 flex min-w-[4.25rem] items-center justify-end gap-1">
          {onDiscard ? <EntryAction label={t("discard")} icon={Trash2} danger className="size-8" onClick={onDiscard} /> : null}
          {onCorrect ? <EntryAction label={t(r.changes ? "seeChanges" : "correct")} icon={PenLine} className={cn("size-8", r.changes && "text-primary")} onClick={onCorrect} /> : null}
          {r.status === "live" ? (
            <TooltipHint label={action.label}>
              <Button asChild variant="ghost" size="icon" className="size-8 text-muted-foreground">
                <Link href={`/papers/${r.key}`} aria-label={`${action.label}: ${title}`}>
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
