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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info, Maximize2, Quote, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import type { ExtractionResultWithReview } from "@/lib/extraction/types";
import { MIN_ABSTRACT_LENGTH } from "@/convex/extraction/content";
import {
  getAllCitationLocations,
  getCitationStatus,
} from "@/lib/extraction/citations";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { buildCitationPanelPayload } from "@/lib/extraction/citation-panel";
import { getReviewLabel, getReviewState, isReviewed } from "@/lib/extraction/reviews";
import { HighlightedText } from "./highlighted-text";
import { PaperQuestionProgress } from "@/components/extraction/paper-question-progress";
import { ErrorHistory } from "@/components/extraction/error-history";

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
  const t = useTranslations("extraction");
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
      <div className="min-w-0 overflow-x-hidden rounded-xl border border-border/40 bg-card/90 shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card/95">
              <TableRow className="hover:bg-transparent border-b-2">
                <TableHead className="w-12 pl-6">
                  <Checkbox
                    checked={allSelected || someSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="sticky left-0 w-[320px] min-w-[320px] bg-card/95 font-medium text-foreground">
                  {tc("paper")}
                </TableHead>
                {showCredits && (
                  <TableHead
                    className="w-[100px] min-w-[100px] text-right font-medium text-foreground tabular-nums"
                    data-column="credits"
                  >
                    {tc("credits")}
                  </TableHead>
                )}
                {questions.map((q) => (
                  <TableHead
                    key={q.key}
                    className="min-w-[220px] font-medium text-foreground"
                  >
                    <div className="flex items-center gap-2">
                      <span>{q.question}</span>
                      {q.description && (
                        <Popover>
                          <PopoverTrigger>
                            <Info className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
                          </PopoverTrigger>
                          <PopoverContent className="p-3 text-xs w-64">
                            {q.description}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {papers.map((paper, idx) => {
                const isSelected = selectedIds.has(paper._id);
                const hasAbstract =
                  !!paper.abstract &&
                  paper.abstract.length > MIN_ABSTRACT_LENGTH;
                const hasPdfSource =
                  !!paper.pdfUrl ||
                  !!paper.storageId ||
                  !!paper.ragEntryId ||
                  !!paper.isIndexed;
                const showAbstractBadge =
                  hasAbstract &&
                  !paper.pdfContentUsed &&
                  !paper.isIndexed &&
                  !paper.ragEntryId &&
                  paper.status !== "download_failed";
                const abstractLabel =
                  !paper.isOpenAccess && !hasPdfSource
                    ? tc("abstractOnly")
                    : tc("abstract");
                const showNoContent =
                  paper.status === "download_failed" && !hasAbstract;
                const reviewedCount = paper.results.filter((result) => isReviewed(result)).length;

                const completedCount = paper.results.filter(
                  (r) => r.status === "completed",
                ).length;
                const questionProgress = `${completedCount}/${Math.max(
                  questions.length,
                  paper.results.length,
                )}`;

                return (
                  <TableRow
                    key={paper._id}
                    data-paper-id={paper._id}
                    data-paper-status={paper.status}
                    data-question-progress={questionProgress}
                    className={cn(
                      "group hover:bg-muted/50 transition-colors cursor-pointer",
                      isSelected && "bg-primary/5",
                      idx % 2 === 0 && "bg-muted/20"
                    )}
                    onClick={() => toggleSelect(paper._id)}
                  >
                    {/* Checkbox Column */}
                    <TableCell className="pl-6" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(paper._id)}
                      />
                    </TableCell>

                    {/* Paper Info Column */}
                    <TableCell className="sticky left-0 bg-card/95 py-4 align-top">
                      <div className="space-y-1.5 max-w-[300px]">
                        <div
                          className="font-medium text-sm leading-snug line-clamp-2"
                          title={paper.title}
                        >
                          <HighlightedText text={paper.title} query={searchQuery} />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {paper.publicationYear && (
                            <Badge
                              variant="outline"
                              className="h-5 px-1.5 text-[10px] font-normal"
                            >
                              {paper.publicationYear}
                            </Badge>
                          )}
                          {paper.doi && (
                            <a
                              href={`https://doi.org/${paper.doi}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center hover:text-primary transition-colors hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              DOI <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 pt-1">
                          {showNoContent ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
                            >
                              {tc("noContent")}
                            </Badge>
                          ) : null}
                          {paper.isOpenAccess && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
                            >
                              {tc("openAccess")}
                            </Badge>
                          )}
                          {pdfEnabled && (paper.isIndexed || paper.ragEntryId) ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20"
                            >
                              {tc("indexed")}
                            </Badge>
                          ) : null}
                          {pdfEnabled && paper.pdfContentUsed ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                            >
                              {tc("pdfUsed")}
                            </Badge>
                          ) : null}
                          {showAbstractBadge ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] text-muted-foreground border-border"
                            >
                              {abstractLabel}
                            </Badge>
                          ) : null}
                          {reviewedCount > 0 ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
                            >
                              {t("reviewed", { count: reviewedCount, total: paper.results.length })}
                            </Badge>
                          ) : null}
                        </div>

                        {/* Plan-07: inline per-paper question progress.
                            Pure presentational — counts derive from
                            paper.results. Renders a group role with
                            data-question-progress for behavior tests. */}
                        <div
                          className="pt-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <PaperQuestionProgress
                            paperStatus={paper.status}
                            results={paper.results}
                            totalQuestions={questions.length}
                          />
                        </div>

                        {/* Plan-07: expandable error history.
                            Self-hides when the paper has no error rows
                            (the 99% happy path). Click bubbling is
                            stopped so toggling the accordion doesn't
                            also toggle the row selection. */}
                        <div onClick={(e) => e.stopPropagation()}>
                          <ErrorHistory paperId={paper._id} />
                        </div>
                      </div>
                    </TableCell>

                    {showCredits && (
                      <TableCell
                        className="align-top py-4 text-right tabular-nums"
                        data-column="credits"
                        data-credits={String(paper.creditsUsed ?? 0)}
                      >
                        {(paper.creditsUsed ?? 0).toLocaleString()}
                      </TableCell>
                    )}

                    {/* Results Columns */}
                    {questions.map((q) => {
                      const result = paper.results.find(
                        (r) => r.questionKey === q.key,
                      );
                      return (
                        <TableCell
                          key={q.key}
                          className="align-top py-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ResultCell
                            result={result}
                            type={q.type}
                            searchQuery={searchQuery}
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
                              if (!payload) return;
                              onOpenCitationPanel(payload);
                            }}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
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


const ResultCell = memo(function ResultCell({
  result,
  type,
  searchQuery,
  onCite,
}: {
  result?: ExtractionResultWithReview;
  type: string;
  searchQuery?: string;
  onCite?: () => void;
}) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  if (!result) {
    return <span className="text-muted-foreground/30 text-xs">—</span>;
  }

  const { answer, confidence, reasoning } = result;
  const citations = getAllCitationLocations(result);
  const citationStatus = getCitationStatus(result);
  const reviewState = getReviewState(result);
  const reviewLabel = getReviewLabel(reviewState);

  const getConfidenceColor = (conf?: number) => {
    if (!conf) return "bg-gray-500/10 text-gray-500";
    if (conf >= 0.8)
      return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200";
    if (conf >= 0.5)
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200";
    return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200";
  };

  return (
    <div className="space-y-2">
      {/* Visual confidence bar */}
      {confidence !== undefined && (
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-500 ease-out",
              confidence >= 0.8 ? "bg-green-500" :
              confidence >= 0.5 ? "bg-yellow-500" :
              "bg-red-500"
            )}
            style={{ width: `${(confidence || 0) * 100}%` }}
          />
        </div>
      )}

      {/* Answer value with highlighting */}
      <div className="text-sm">
        {type === "boolean" ? (
          answer === true ? (
            <Badge
              variant="default"
              className="font-normal bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 shadow-none"
            >
              {tc("yes")}
            </Badge>
          ) : answer === false ? (
            <Badge
              variant="secondary"
              className="font-normal bg-muted text-muted-foreground hover:bg-muted/80"
            >
              {tc("no")}
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {tc("unknown")}
            </Badge>
          )
        ) : Array.isArray(answer) ? (
          <div className="flex flex-wrap gap-1">
            {answer.map((item) => (
              <Badge
                key={String(item)}
                variant="outline"
                className="text-xs font-normal"
              >
                <HighlightedText text={String(item)} query={searchQuery || ''} />
              </Badge>
            ))}
          </div>
        ) : (
          <div className="line-clamp-3 text-sm text-foreground/90 leading-relaxed">
            <HighlightedText text={String(answer)} query={searchQuery || ''} />
          </div>
        )}
      </div>

      {/* Footer with actions */}
      <div className="flex items-center gap-2">
        {confidence !== undefined && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-medium",
              getConfidenceColor(confidence)
            )}
          >
            {Math.round((confidence || 0) * 100)}%
          </Badge>
        )}
        {citationStatus === "grounded" ? (
          <Badge variant="outline" className="text-[10px] font-medium">
            {tc("grounded")}
          </Badge>
        ) : null}
        {citationStatus === "best_effort" ? (
          <Badge variant="outline" className="text-[10px] font-medium">
            {tc("bestEffort")}
          </Badge>
        ) : null}
        {citationStatus === "insufficient_evidence" ? (
          <Badge variant="outline" className="text-[10px] font-medium">
            {tc("insufficientEvidence")}
          </Badge>
        ) : null}
        {citationStatus === "extraction_error" ? (
          <Badge variant="outline" className="text-[10px] font-medium">
            {tc("extractionError")}
          </Badge>
        ) : null}
        {reviewLabel && reviewState !== "unreviewed" ? (
          <Badge variant="outline" className="text-[10px] font-medium">
            {t(reviewLabel)}
          </Badge>
        ) : null}

        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {reasoning && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground/50 hover:text-primary transition-colors"
                >
                  <Maximize2 className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 text-xs leading-relaxed">
                <div className="space-y-1">
                  <h4 className="font-medium">{tc("reasoning")}</h4>
                  <p className="text-muted-foreground">
                    <HighlightedText text={reasoning} query={searchQuery || ''} />
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {citations.length > 0 && onCite ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onCite}
              className="h-5 w-5 text-muted-foreground/60 hover:text-foreground transition-colors"
              title={tc("viewCitation")}
            >
              <Quote className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
});
