"use client";

import { useState, memo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Maximize2, Quote, ExternalLink } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import { getAvgConfidence } from "@/lib/extraction/filtering";
import { ConfidenceRing } from "../confidence-ring";
import { PdfCitationDrawer } from "@/components/extraction/pdf-citation-drawer";
import { MIN_ABSTRACT_LENGTH } from "@/convex/extraction/content";
import {
  getAllCitationLocations,
  getCitationStatus,
  type CitationStatus,
  type CitationLocation,
} from "@/lib/extraction/citations";

interface CardViewProps {
  papers: PaperWithResults[];
  questions: Question[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
}

export const CardView = memo(function CardView({
  papers,
  questions,
  selectedIds,
  onSelectionChange,
}: CardViewProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPaperId, setSelectedPaperId] = useState<Doc<"extractionPapers">["_id"] | null>(null);
  const [selectedPaperTitle, setSelectedPaperTitle] = useState<string | null>(null);
  const [selectedCitations, setSelectedCitations] = useState<CitationLocation[]>([]);
  const [selectedCitationStatus, setSelectedCitationStatus] = useState<CitationStatus | undefined>(undefined);
  const [selectedAnswerText, setSelectedAnswerText] = useState<string | null>(null);
  const [selectedQuestionText, setSelectedQuestionText] = useState<string | null>(null);

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
        citations={selectedCitations}
        citationStatus={selectedCitationStatus}
        answerText={selectedAnswerText}
        questionText={selectedQuestionText}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {papers.map(paper => {
          const isSelected = selectedIds.has(paper._id);
          const avgConfidence = getAvgConfidence(paper);
          const hasAbstract =
            !!paper.abstract &&
            paper.abstract.length > MIN_ABSTRACT_LENGTH;
          const hasPdfSource =
            !!paper.pdfUrl ||
            !!paper.storageId ||
            !!paper.ragEntryId ||
            !!paper.isIndexed;
          const showNoContent =
            paper.status === "download_failed" && !hasAbstract;

          return (
            <Card
              key={paper._id}
              className={cn(
                "group hover:shadow-md transition-all cursor-pointer",
                isSelected && "ring-2 ring-primary"
              )}
              onClick={() => toggleSelect(paper._id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(paper._id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <CardTitle className="text-base line-clamp-2">
                        {paper.title}
                      </CardTitle>
                    </div>
                    <CardDescription>
                      <div className="flex items-center gap-2 text-xs">
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
                      <div className="flex items-center gap-1.5 pt-2">
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
                      </div>
                    </CardDescription>
                  </div>
                  <ConfidenceRing value={avgConfidence} size={48} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3" onClick={(e) => e.stopPropagation()}>
                {questions.map(q => {
                  const result = paper.results.find(r => r.questionKey === q.key);
                  return (
                    <div key={q.key} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <h5 className="text-xs font-medium text-muted-foreground mb-1">
                          {q.question}
                        </h5>
                        <ResultValue result={result} type={q.type} />
                      </div>
                      <ResultActions
                        result={result}
                        onCite={() => {
                          if (!result) return;
                          const citations = getAllCitationLocations(result);
                          if (citations.length === 0) return;
                          setSelectedPaperId(paper._id);
                          setSelectedPaperTitle(paper.title);
                          setSelectedCitations(citations);
                          const answerText = Array.isArray(result.answer)
                            ? result.answer
                                .filter((item) => typeof item === "string")
                                .sort((a, b) => b.length - a.length)[0]
                            : result.answer !== null && result.answer !== undefined
                              ? String(result.answer)
                              : null;
                          setSelectedAnswerText(answerText ?? null);
                          setSelectedQuestionText(q.question);
                          setSelectedCitationStatus(getCitationStatus(result));
                          setDrawerOpen(true);
                        }}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.papers === nextProps.papers &&
    prevProps.questions === nextProps.questions &&
    prevProps.selectedIds === nextProps.selectedIds
  );
});

function ResultValue({ result, type }: { result?: Doc<"extractionResults">; type: string }) {
  if (!result) {
    return <span className="text-muted-foreground/30 text-xs">—</span>;
  }

  const { answer, confidence } = result;
  const citationStatus = getCitationStatus(result);

  const getConfidenceColor = (conf?: number) => {
    if (!conf) return "bg-gray-500/10 text-gray-500 border-gray-200";
    if (conf >= 0.8)
      return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200";
    if (conf >= 0.5)
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200";
    return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200";
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
          <div className="line-clamp-2 text-sm text-foreground/90 leading-relaxed">
            {String(answer)}
          </div>
        )}
      </div>
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
          Grounded
        </Badge>
      ) : null}
      {citationStatus === "best_effort" ? (
        <Badge variant="outline" className="text-[10px] font-medium">
          Best effort
        </Badge>
      ) : null}
      {citationStatus === "insufficient_evidence" ? (
        <Badge variant="outline" className="text-[10px] font-medium">
          Insufficient evidence
        </Badge>
      ) : null}
      {citationStatus === "extraction_error" ? (
        <Badge variant="outline" className="text-[10px] font-medium">
          Extraction error
        </Badge>
      ) : null}
    </div>
  );
}

function ResultActions({
  result,
  onCite,
}: {
  result?: Doc<"extractionResults">;
  onCite?: () => void;
}) {
  if (!result) return null;

  const { reasoning } = result;
  const citations = getAllCitationLocations(result);

  return (
    <div className="flex flex-col gap-1">
      {reasoning && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/50 hover:text-primary transition-colors"
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4 text-xs leading-relaxed">
            <div className="space-y-1">
              <h4 className="font-medium">Reasoning</h4>
              <p className="text-muted-foreground">{reasoning}</p>
            </div>
          </PopoverContent>
        </Popover>
      )}
      {citations.length > 0 && onCite ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onCite}
          className="h-6 w-6 text-muted-foreground/60 hover:text-foreground transition-colors"
          title="View citation"
        >
          <Quote className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}
