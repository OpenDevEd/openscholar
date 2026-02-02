"use client";

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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FileText, Info, Loader2, Maximize2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";
import { MIN_ABSTRACT_LENGTH } from "@/convex/extraction/content";

interface PaperWithResults extends Doc<"extractionPapers"> {
  results: Doc<"extractionResults">[];
}

interface ResultsTableProps {
  papers: PaperWithResults[];
  questions: Doc<"extractionQuestions">[];
  isLoading?: boolean;
  loadMore?: () => void;
  status: string;
}

export function ResultsTable({
  papers,
  questions,
  isLoading,
  loadMore,
  status,
}: ResultsTableProps) {
  if (papers.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border rounded-xl bg-muted/20 border-border/40">
        <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-medium">No results yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm mt-2">
          {status === "completed"
            ? "No papers matched your criteria or extraction failed."
            : "Results will appear here as they are processed."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/40 overflow-hidden bg-card/50 backdrop-blur-sm shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[300px] min-w-[300px] pl-6 font-medium text-foreground">
                  Paper
                </TableHead>
                {questions.map((q) => (
                  <TableHead
                    key={q._id}
                    className="min-w-[200px] font-medium text-foreground"
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
              {papers.map((paper) => {
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
                    className="group hover:bg-muted/30 transition-colors"
                  >
                    {/* Paper Info Column */}
                    <TableCell className="pl-6 align-top py-4">
                      <div className="space-y-1.5 max-w-[280px]">
                        <div
                          className="font-medium text-sm leading-snug line-clamp-2"
                          title={paper.title}
                        >
                          {paper.title}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {paper.publicationYear && (
                            <Badge
                              variant="outline"
                              className="h-5 px-1.5 text-[10px font-normal"
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
                        <TableCell key={q._id} className="align-top py-4">
                          <ResultCell result={result} type={q.type} />
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

      {loadMore && (
        <div className="flex justify-center py-4">
          <Button
            variant="ghost"
            onClick={loadMore}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              "Load more papers"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function ResultCell({
  result,
  type,
}: {
  result?: Doc<"extractionResults">;
  type: string;
}) {
  if (!result) {
    return <span className="text-muted-foreground/30 text-xs">—</span>;
  }

  const { answer, confidence, reasoning } = result;

  const getConfidenceColor = (conf?: number) => {
    if (!conf) return "bg-gray-500/10 text-gray-500";
    if (conf >= 0.8)
      return "bg-green-500/10 text-green-600 dark:text-green-400";
    if (conf >= 0.5)
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
    return "bg-red-500/10 text-red-600 dark:text-red-400";
  };

  return (
    <div className="space-y-2">
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
              <Badge key={i} variant="outline" className="text-xs font-normal">
                {item}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="line-clamp-3 text-sm text-foreground/90 leading-relaxed">
            {String(answer)}
          </div>
        )}
      </div>

      {(confidence || reasoning) && (
        <div className="flex items-center gap-2">
          {confidence !== undefined && (
            <div
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium",
                getConfidenceColor(confidence),
              )}
            >
              {Math.round(confidence * 100)}%
            </div>
          )}
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
              <PopoverContent className="w-80 p-4 text-xs leading-relaxed bg-popover/95 backdrop-blur shadow-xl border-border/50">
                <div className="space-y-1">
                  <h4 className="font-medium text-foreground">Reasoning</h4>
                  <p className="text-muted-foreground">{reasoning}</p>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}
