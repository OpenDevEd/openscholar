"use client";

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { defaultRangeExtractor, useVirtualizer, useWindowVirtualizer, type Range } from "@tanstack/react-virtual";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipHint } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import { openAnswerKey, type OpenAnswer } from "@/components/extraction/answer-panel";
import { HighlightedText } from "./highlighted-text";
import { PaperQuestionProgress } from "@/components/extraction/paper-question-progress";
import { PaperDetails, ResultCell } from "./result-parts";

interface TableViewProps {
  papers: PaperWithResults[];
  questions: Question[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  searchQuery?: string;
  onOpenAnswer: (answer: OpenAnswer) => void;
  /** The answer open in the side panel, to highlight its cell. */
  openAnswer?: string | null;
  usePdfs: boolean;
  /** Plan-04: opt-in per-paper Credits column, toggled via toolbar. */
  showCredits?: boolean;
}

/** A row's height before it is measured: a paper with three lines of answers. */
const ROW_ESTIMATE = 140;

/** One paper's row. Memoised, so a change to another row, or a resize, leaves it alone. */
const PaperRow = memo(function PaperRow({
  index,
  measureRef,
  paper,
  questions,
  isSelected,
  onToggleSelect,
  searchQuery,
  pdfEnabled,
  showCredits,
  pinnedShadow,
  openAnswer,
  onOpenAnswer,
}: {
  index: number;
  measureRef: (row: HTMLTableRowElement | null) => void;
  paper: PaperWithResults;
  questions: Question[];
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  searchQuery: string;
  pdfEnabled: boolean;
  showCredits: boolean;
  pinnedShadow: string;
  openAnswer: string | null;
  onOpenAnswer: (answer: OpenAnswer) => void;
}) {
  const completedCount = paper.results.filter((r) => r.status === "completed").length;
  const questionProgress = `${completedCount}/${Math.max(questions.length, paper.results.length)}`;
  return (
    <TableRow
      ref={measureRef}
      data-index={index}
      aria-rowindex={index + 2}
      data-paper-id={paper._id}
      data-paper-status={paper.status}
      data-question-progress={questionProgress}
      data-state={isSelected ? "selected" : undefined}
      className="group cursor-pointer"
      onClick={() => onToggleSelect(paper._id)}
    >
      {/* The paper stays in view while the answers scroll sideways; its hover colour is opaque so they never show through. */}
      <TableCell className={cn(pinnedShadow, "sticky left-0 z-10 bg-card py-4 pl-4 pr-4 align-top whitespace-normal group-hover:bg-inset group-data-[state=selected]:bg-muted md:pl-6")}>
        <div className="flex max-w-[188px] gap-3 sm:max-w-[288px]">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(paper._id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={paper.title}
            className="mt-0.5"
          />
          <div className="min-w-0 space-y-1.5">
            <TooltipHint label={paper.title} onlyWhenClipped>
              <p className="line-clamp-4 text-sm font-medium leading-snug">
                <HighlightedText text={paper.title} query={searchQuery} />
              </p>
            </TooltipHint>
            <PaperDetails paper={paper} pdfEnabled={pdfEnabled} />
            <div onClick={(e) => e.stopPropagation()}>
              <PaperQuestionProgress paperStatus={paper.status} results={paper.results} totalQuestions={questions.length} />
            </div>
          </div>
        </div>
      </TableCell>

      {showCredits && (
        <TableCell className="py-4 text-right align-top tabular-nums" data-column="credits" data-credits={String(paper.creditsUsed ?? 0)}>
          {(paper.creditsUsed ?? 0).toLocaleString()}
        </TableCell>
      )}

      {questions.map((q) => {
        const result = paper.results.find((r) => r.questionKey === q.key);
        return (
          <TableCell key={q.key} className="relative isolate py-4 pl-4 pr-9 align-top whitespace-normal" onClick={(e) => e.stopPropagation()}>
            <ResultCell
              result={result}
              type={q.type}
              searchQuery={searchQuery}
              fill
              selected={openAnswer === openAnswerKey({ paper, question: q, result })}
              onOpen={() => onOpenAnswer({ paper, question: q, result })}
            />
          </TableCell>
        );
      })}
    </TableRow>
  );
});

export const TableView = memo(function TableView({
  papers,
  questions,
  selectedIds,
  onSelectionChange,
  searchQuery = '',
  onOpenAnswer,
  openAnswer,
  usePdfs,
  showCredits = false,
}: TableViewProps) {
  // React Compiler skips this component, as TanStack Virtual is on its list of
  // incompatible libraries, so the callbacks the rows get are memoised by hand.
  "use no memo";
  const tc = useTranslations("common");
  const pdfEnabled = usePdfs;
  const allSelected = papers.length > 0 && papers.every(p => selectedIds.has(p._id));
  const someSelected = papers.some(p => selectedIds.has(p._id)) && !allSelected;

  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    for (const paper of papers) {
      if (allSelected) next.delete(paper._id);
      else next.add(paper._id);
    }
    onSelectionChange(next);
  };

  const toggleSelect = useCallback((id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    onSelectionChange(newSet);
  }, [selectedIds, onSelectionChange]);

  // Only the rows near the screen are drawn. A page holds hundreds of papers, and
  // drawing all of them made every frame of a side panel's slide re-lay and
  // repaint the whole table. The rows scroll with the page, or inside the results
  // pane on a phone with an answer open, so the virtualizer needs that scroller and
  // where the rows start in it; anything above them can grow, so its size is watched.
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [pane, setPane] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const scroller = body.closest<HTMLElement>("[data-results-scroller]");
    setPane(scroller);
    const measure = () => {
      const top = scroller ? scroller.getBoundingClientRect().top - scroller.scrollTop : -window.scrollY;
      setScrollMargin(Math.round(body.getBoundingClientRect().top - top));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller?.firstElementChild ?? document.body);
    return () => observer.disconnect();
  }, []);
  // A row holding keyboard focus stays drawn after it scrolls away, so focus is not dropped.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = focusedId ? papers.findIndex((paper) => paper._id === focusedId) : -1;
  const options = {
    count: papers.length,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 6,
    scrollMargin,
    getItemKey: (index: number) => papers[index]._id,
    rangeExtractor: (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return focused < 0 || indexes.includes(focused) ? indexes : [...indexes, focused].sort((a, b) => a - b);
    },
  };
  const windowRows = useWindowVirtualizer({ ...options, enabled: !pane });
  const paneRows = useVirtualizer({ ...options, getScrollElement: () => pane, enabled: !!pane });
  const rows = pane ? paneRows : windowRows;
  const columnCount = 1 + (showCredits ? 1 : 0) + questions.length;
  const spacer = (height: number) => height > 0 ? <tr aria-hidden style={{ height }}><td colSpan={columnCount} className="p-0" /></tr> : null;
  let drawnTo = scrollMargin;

  // Edge fades while there is more to scroll to. The table's own scroll box
  // is outside React, so a listener and resize observer keep this in step.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const box = scrollRef.current?.querySelector<HTMLElement>('[data-slot="table-container"]');
    if (!box) return;
    // Only a change counts: the box resizes on every frame while a side panel
    // slides, and a fresh object each time would redraw the whole table each frame.
    const update = () => {
      const start = box.scrollLeft <= 1;
      const end = box.scrollLeft + box.clientWidth >= box.scrollWidth - 1;
      setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    update();
    box.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => {
      box.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  // Answers fade into the card as they slide under the pinned paper column.
  const pinnedShadow = cn(
    "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-10 after:translate-x-full after:bg-gradient-to-r after:from-card after:to-transparent after:transition-opacity after:duration-150",
    edges.start ? "after:opacity-0" : "after:opacity-100",
  );

  return (
    // The virtualizer keeps the rows in place as they are measured, so the browser's own scroll anchoring stays out of the table.
    <div ref={scrollRef} className="relative [overflow-anchor:none]">
      {/* Opaque, so the pinned paper column matches the cells scrolling under it.
          Fixed layout, so column widths never change as rows come and go: the answers share what the paper column leaves, at least 240px each. */}
      <Table
        aria-rowcount={papers.length + 1}
        className="table-fixed bg-card [--paper-column:220px] sm:[--paper-column:320px]"
        style={{ minWidth: `calc(var(--paper-column) + ${(showCredits ? 100 : 0) + questions.length * 240}px)` } as CSSProperties}
      >
        <TableHeader>
          <TableRow aria-rowindex={1} className="hover:bg-transparent">
            <TableHead className={cn(pinnedShadow, "sticky left-0 z-10 w-[220px] min-w-[220px] bg-card pl-4 pr-4 sm:w-[320px] sm:min-w-[320px] md:pl-6")}>
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleSelectAll}
                />
                {tc("paper")}
              </div>
            </TableHead>
            {showCredits && (
              <TableHead className="w-[100px] min-w-[100px] text-right tabular-nums" data-column="credits">
                {tc("credits")}
              </TableHead>
            )}
            {questions.map((q) => (
              <TableHead key={q.key} className="whitespace-normal">
                <div className="flex items-center gap-1.5">
                  <TooltipHint label={q.question} onlyWhenClipped>
                    <span className="line-clamp-1">{q.question}</span>
                  </TooltipHint>
                  {q.description && (
                    <Popover>
                      <PopoverTrigger aria-label={tc("details")} className="mt-0.5 shrink-0 text-muted-foreground/60 hover:text-muted-foreground">
                        <Info className="size-3.5" />
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3 text-xs">{q.description}</PopoverContent>
                    </Popover>
                  )}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody
          ref={bodyRef}
          onFocus={(event) => setFocusedId(event.target.closest<HTMLElement>("tr[data-paper-id]")?.dataset.paperId ?? null)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null);
          }}
        >
          {rows.getVirtualItems().map(({ index, key, start, end }) => {
            const paper = papers[index];
            const gap = start - drawnTo;
            drawnTo = end;
            return (
              <Fragment key={key}>
                {spacer(gap)}
                <PaperRow
                  index={index}
                  measureRef={rows.measureElement}
                  paper={paper}
                  questions={questions}
                  isSelected={selectedIds.has(paper._id)}
                  onToggleSelect={toggleSelect}
                  searchQuery={searchQuery}
                  pdfEnabled={pdfEnabled}
                  showCredits={showCredits}
                  pinnedShadow={pinnedShadow}
                  // Only the row that holds the open answer hears about it, so opening one redraws two rows, not all.
                  openAnswer={openAnswer?.startsWith(`${paper._id}:`) ? openAnswer : null}
                  onOpenAnswer={onOpenAnswer}
                />
              </Fragment>
            );
          })}
          {spacer(scrollMargin + rows.getTotalSize() - drawnTo)}
        </TableBody>
      </Table>
      {/* More columns off to the right. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card to-transparent transition-opacity duration-150",
          edges.end ? "opacity-0" : "opacity-100",
        )}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.papers === nextProps.papers &&
    prevProps.questions === nextProps.questions &&
    prevProps.selectedIds === nextProps.selectedIds &&
    prevProps.searchQuery === nextProps.searchQuery &&
    prevProps.onOpenAnswer === nextProps.onOpenAnswer &&
    prevProps.openAnswer === nextProps.openAnswer &&
    prevProps.showCredits === nextProps.showCredits
  );
});

