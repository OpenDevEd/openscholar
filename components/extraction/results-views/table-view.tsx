"use client";

import { memo } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info } from "lucide-react";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import {
  getAllCitationLocations,
  getCitationStatus,
} from "@/lib/extraction/citations";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { buildCitationPanelPayload } from "@/lib/extraction/citation-panel";
import { HighlightedText } from "./highlighted-text";
import { PaperQuestionProgress } from "@/components/extraction/paper-question-progress";
import { PaperDetails, ResultActions, ResultAnswer, ResultMeta } from "./result-parts";

interface TableViewProps {
  papers: PaperWithResults[];
  questions: Question[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  searchQuery?: string;
  onOpenCitationPanel: (payload: CitationPanelPayload) => void;
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
  onOpenCitationPanel,
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

  return (
    // Opaque, so the pinned paper column matches the cells scrolling under it.
    <Table className="bg-card">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="sticky left-0 z-10 w-[220px] min-w-[220px] bg-card py-2 pl-4 align-bottom sm:w-[320px] sm:min-w-[320px] md:pl-6">
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
            <TableHead key={q.key} className="min-w-[240px] max-w-[320px] whitespace-normal py-2 align-bottom">
              <div className="flex items-start gap-1.5">
                <span className="line-clamp-2" title={q.question}>{q.question}</span>
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
              {/* The paper stays in view while the answers scroll sideways. */}
              <TableCell className="sticky left-0 z-10 bg-card py-4 pl-4 align-top whitespace-normal group-hover:bg-muted/50 group-data-[state=selected]:bg-muted md:pl-6">
                <div className="flex max-w-[200px] gap-3 sm:max-w-[300px]">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelect(paper._id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={paper.title}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 space-y-1.5">
                    <p className="line-clamp-2 text-sm font-medium leading-snug" title={paper.title}>
                      <HighlightedText text={paper.title} query={searchQuery} />
                    </p>
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
                  <TableCell key={q.key} className="max-w-[320px] py-4 align-top whitespace-normal" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-1.5">
                      <ResultAnswer result={result} type={q.type} searchQuery={searchQuery} />
                      <div className="flex items-center justify-between gap-2">
                        <ResultMeta result={result} />
                        {/* Shown on hover or keyboard focus, so rows stay quiet. */}
                        <ResultActions
                          result={result}
                          searchQuery={searchQuery}
                          className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                          onCite={() => {
                            if (!result) return;
                            const citations = getAllCitationLocations(result);
                            if (citations.length === 0) return;
                            const payload = buildCitationPanelPayload({
                              paperId: paper._id,
                              paperTitle: paper.title,
                              citations,
                              citationStatus: getCitationStatus(result),
                              answer: result.answer,
                              questionText: q.question,
                            });
                            if (payload) onOpenCitationPanel(payload);
                          }}
                        />
                      </div>
                    </div>
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.papers === nextProps.papers &&
    prevProps.questions === nextProps.questions &&
    prevProps.selectedIds === nextProps.selectedIds &&
    prevProps.searchQuery === nextProps.searchQuery &&
    prevProps.onOpenCitationPanel === nextProps.onOpenCitationPanel &&
    prevProps.showCredits === nextProps.showCredits
  );
});

