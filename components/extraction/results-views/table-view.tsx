"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
import { Info } from "lucide-react";
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
  const tc = useTranslations("common");
  const pdfEnabled = usePdfs;
  const allSelected = papers.length > 0 && papers.every(p => selectedIds.has(p._id));
  const someSelected = papers.some(p => selectedIds.has(p._id)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(papers.map(p => p._id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    onSelectionChange(newSet);
  };

  // Edge fades while there is more to scroll to. The table's own scroll box
  // is outside React, so a listener and resize observer keep this in step.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const box = scrollRef.current?.querySelector<HTMLElement>('[data-slot="table-container"]');
    if (!box) return;
    const update = () => setEdges({
      start: box.scrollLeft <= 1,
      end: box.scrollLeft + box.clientWidth >= box.scrollWidth - 1,
    });
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
    <div ref={scrollRef} className="relative">
      {/* Opaque, so the pinned paper column matches the cells scrolling under it. */}
      <Table className="bg-card">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
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
              <TableHead key={q.key} className="min-w-[240px] max-w-[320px] whitespace-normal">
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
        <TableBody>
          {papers.map((paper) => {
            const isSelected = selectedIds.has(paper._id);
            const completedCount = paper.results.filter((r) => r.status === "completed").length;
            const questionProgress = `${completedCount}/${Math.max(questions.length, paper.results.length)}`;
            return (
              <TableRow
                key={paper._id}
                data-paper-id={paper._id}
                data-paper-status={paper.status}
                data-question-progress={questionProgress}
                data-state={isSelected ? "selected" : undefined}
                className="group cursor-pointer"
                onClick={() => toggleSelect(paper._id)}
              >
                {/* The paper stays in view while the answers scroll sideways; its hover colour is opaque so they never show through. */}
                <TableCell className={cn(pinnedShadow, "sticky left-0 z-10 bg-card py-4 pl-4 pr-4 align-top whitespace-normal group-hover:bg-[color-mix(in_oklab,var(--card),var(--muted)_50%)] group-data-[state=selected]:bg-muted md:pl-6")}>
                  <div className="flex max-w-[188px] gap-3 sm:max-w-[288px]">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(paper._id)}
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
                    <TableCell key={q.key} className="relative isolate max-w-[320px] py-4 pl-4 pr-9 align-top whitespace-normal" onClick={(e) => e.stopPropagation()}>
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
          })}
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

