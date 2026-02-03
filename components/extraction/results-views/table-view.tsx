"use client";

import { memo, useState } from "react";
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
import type { Doc } from "@/convex/_generated/dataModel";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import { MIN_ABSTRACT_LENGTH } from "@/convex/extraction/content";
import { PdfCitationDrawer } from "@/components/extraction/pdf-citation-drawer";

interface TableViewProps {
  papers: PaperWithResults[];
  questions: Question[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  searchQuery?: string;
}

export const TableView = memo(function TableView({
  papers,
  questions,
  selectedIds,
  onSelectionChange,
  searchQuery = '',
}: TableViewProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPaperId, setSelectedPaperId] = useState<Doc<"extractionPapers">["_id"] | null>(null);
  const [selectedPaperTitle, setSelectedPaperTitle] = useState<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<string | null>(null);
  const [selectedAnswerText, setSelectedAnswerText] = useState<string | null>(null);
  const [selectedQuestionText, setSelectedQuestionText] = useState<string | null>(null);

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
    <>
      <PdfCitationDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        paperId={selectedPaperId}
        paperTitle={selectedPaperTitle}
        citationChunk={selectedCitation}
        answerText={selectedAnswerText}
        questionText={selectedQuestionText}
      />

      <div className="rounded-xl border border-border/40 overflow-hidden bg-card/50 backdrop-blur-sm shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card/95 backdrop-blur-sm z-10">
              <TableRow className="hover:bg-transparent border-b-2">
                <TableHead className="w-12 pl-6">
                  <Checkbox
                    checked={allSelected || someSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="sticky left-0 w-[320px] min-w-[320px] bg-card/95 backdrop-blur-sm font-medium text-foreground">
                  Paper
                </TableHead>
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
                    ? "Abstract Only"
                    : "Abstract";
                const showNoContent =
                  paper.status === "download_failed" && !hasAbstract;

                return (
                  <TableRow
                    key={paper._id}
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
                    <TableCell className="sticky left-0 bg-card/95 backdrop-blur-sm align-top py-4">
                      <div className="space-y-1.5 max-w-[300px]">
                        <div
                          className="font-medium text-sm leading-snug line-clamp-2"
                          title={paper.title}
                          dangerouslySetInnerHTML={{
                            __html: highlightText(paper.title, searchQuery)
                          }}
                        />
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
                              No Content
                            </Badge>
                          ) : null}
                          {paper.isOpenAccess && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
                            >
                              Open Access
                            </Badge>
                          )}
                          {paper.isIndexed || paper.ragEntryId ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20"
                            >
                              Indexed
                            </Badge>
                          ) : null}
                          {paper.pdfContentUsed ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                            >
                              PDF Used
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
                        </div>
                      </div>
                    </TableCell>

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
                              if (!result?.contextChunks?.length) return;
                              setSelectedPaperId(paper._id);
                              setSelectedPaperTitle(paper.title);
                              setSelectedCitation(result.contextChunks[0]);
                              const answerText = Array.isArray(result.answer)
                                ? result.answer
                                    .filter((item) => typeof item === "string")
                                    .sort((a, b) => b.length - a.length)[0]
                                : result.answer !== null && result.answer !== undefined
                                  ? String(result.answer)
                                  : null;
                              setSelectedAnswerText(answerText ?? null);
                              setSelectedQuestionText(q.question);
                              setDrawerOpen(true);
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
    </>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.papers === nextProps.papers &&
    prevProps.questions === nextProps.questions &&
    prevProps.selectedIds === nextProps.selectedIds &&
    prevProps.searchQuery === nextProps.searchQuery
  );
});

function highlightText(text: string, query: string): string {
  if (!query || !query.trim()) return text;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return text.replace(regex, '<mark class="bg-yellow-200/50 dark:bg-yellow-500/30 rounded px-0.5">$1</mark>');
}

const ResultCell = memo(function ResultCell({
  result,
  type,
  searchQuery,
  onCite,
}: {
  result?: Doc<"extractionResults">;
  type: string;
  searchQuery?: string;
  onCite?: () => void;
}) {
  if (!result) {
    return <span className="text-muted-foreground/30 text-xs">—</span>;
  }

  const { answer, confidence, reasoning } = result;

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
          <Badge
            variant={answer ? "default" : "secondary"}
            className={cn(
              "font-normal",
              answer
                ? "bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 shadow-none"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {answer ? "Yes" : "No"}
          </Badge>
        ) : Array.isArray(answer) ? (
          <div className="flex flex-wrap gap-1">
            {answer.map((item, i) => (
              <Badge
                key={i}
                variant="outline"
                className="text-xs font-normal"
                dangerouslySetInnerHTML={{
                  __html: highlightText(String(item), searchQuery || '')
                }}
              />
            ))}
          </div>
        ) : (
          <div
            className="line-clamp-3 text-sm text-foreground/90 leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: highlightText(String(answer), searchQuery || '')
            }}
          />
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
                  <h4 className="font-medium">Reasoning</h4>
                  <p
                    className="text-muted-foreground"
                    dangerouslySetInnerHTML={{
                      __html: highlightText(reasoning, searchQuery || '')
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          )}

          {result.contextChunks && result.contextChunks.length > 0 && onCite ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onCite}
              className="h-5 w-5 text-muted-foreground/60 hover:text-foreground transition-colors"
              title="View citation"
            >
              <Quote className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
});
