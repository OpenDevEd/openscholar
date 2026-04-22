"use client";

import { useState, memo } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Quote, ExternalLink, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import { getAvgConfidence } from "@/lib/extraction/filtering";
import {
  getAllCitationLocations,
  getCitationStatus,
} from "@/lib/extraction/citations";
import type { CitationLocation } from "@/lib/extraction/citations";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { buildCitationPanelPayload } from "@/lib/extraction/citation-panel";

interface SplitViewProps {
  papers: PaperWithResults[];
  questions: Question[];
  onOpenCitationPanel: (payload: CitationPanelPayload) => void;
}

export const SplitView = memo(function SplitView({ papers, questions, onOpenCitationPanel }: SplitViewProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(
    papers.length > 0 ? papers[0]._id : null
  );

  const selectedPaper = papers.find(p => p._id === selectedPaperId);

  return (
      <div className="h-[calc(100vh-400px)] min-h-[500px] max-h-[800px] overflow-hidden rounded-xl border border-border/40 bg-card/50 shadow-sm">
        <div className="flex h-full min-w-0 flex-col lg:flex-row">
          {/* Left: Paper list */}
          <div className="h-56 w-full overflow-y-auto border-b border-border/40 bg-muted/30 lg:h-full lg:w-[320px] lg:min-w-[320px] lg:border-b-0 lg:border-r">
            {papers.map(paper => {
              const avgConfidence = getAvgConfidence(paper);
              const isSelected = selectedPaperId === paper._id;
              return (
                <div
                  key={paper._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPaperId(paper._id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedPaperId(paper._id);
                    }
                  }}
                  className={cn(
                    "p-4 border-b border-border/40 cursor-pointer hover:bg-muted/50 transition-colors",
                    isSelected && "bg-primary/5 border-l-2 border-l-primary"
                  )}
                >
                  <h4 className="text-sm font-medium line-clamp-2 mb-1">
                    {paper.title}
                  </h4>
                  <div className="flex items-center gap-2">
                    {paper.publicationYear && (
                      <span className="text-xs text-muted-foreground">
                        {paper.publicationYear}
                      </span>
                    )}
                    <ConfidenceBadge value={avgConfidence} size="sm" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Extracted data */}
          <div className="h-full min-w-0 flex-1 overflow-y-auto bg-card/30 p-4 sm:p-6">
            {selectedPaper ? (
              <div className="space-y-6">
                <div className="border-b border-border/40 pb-4">
                  <h2 className="text-lg font-semibold mb-2">{selectedPaper.title}</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedPaper.publicationYear && (
                      <Badge variant="outline" className="text-xs">
                        {selectedPaper.publicationYear}
                      </Badge>
                    )}
                    {selectedPaper.doi && (
                      <a
                        href={`https://doi.org/${selectedPaper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                      >
                        DOI <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <ConfidenceBadge value={getAvgConfidence(selectedPaper)} />
                  </div>
                </div>

                <div className="space-y-4">
                  {questions.map(q => {
                    const result = selectedPaper.results.find(r => r.questionKey === q.key);
                    const citations = getAllCitationLocations(result);
                    return (
                      <div key={q.key} className="bg-card rounded-lg border border-border/40 p-4">
                        <h3 className="font-medium text-sm mb-3">{q.question}</h3>
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr,280px]">
                          <div className="space-y-2">
                            <ResultValue result={result} type={q.type} />
                            {result?.reasoning && (
                              <p className="text-xs text-muted-foreground mt-2 bg-muted/50 p-2 rounded">
                                {result.reasoning}
                              </p>
                            )}
                          </div>
                          {citations.length > 0 && (
                            <CitationPreview
                              citation={citations[0]}
                              onClick={() => {
                                if (!result) return;
                                if (citations.length === 0) return;
                                const payload = buildCitationPanelPayload({
                                  paperId: selectedPaper._id,
                                  paperTitle: selectedPaper.title,
                                  citations,
                                  citationStatus: getCitationStatus(result),
                                  answer: result.answer,
                                  questionText: q.question,
                                });
                                if (!payload) return;
                                onOpenCitationPanel(payload);
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
                <p className="text-sm text-muted-foreground">{t("selectPaperToView")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.papers === nextProps.papers &&
    prevProps.questions === nextProps.questions &&
    prevProps.onOpenCitationPanel === nextProps.onOpenCitationPanel
  );
});

function ConfidenceBadge({ value, size = "md", className }: { value: number; size?: "sm" | "md"; className?: string }) {
  const percentage = Math.round(value * 100);
  const color =
    value >= 0.8 ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
    value >= 0.5 ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" :
    "bg-destructive/10 text-destructive border-destructive/20";

  return (
    <Badge variant="outline" className={cn(size === "sm" ? "text-[10px]" : "text-xs", "font-medium", color, className)}>
      {percentage}%
    </Badge>
  );
}

function ResultValue({ result, type }: { result?: Doc<"extractionResults">; type: string }) {
  const tc = useTranslations("common");
  if (!result) return <span className="text-muted-foreground/50 text-sm">{tc("noResultsFound")}</span>;

  const { answer } = result;
  const citationStatus = getCitationStatus(result);

  return (
    <div className="text-sm space-y-1">
      {type === "boolean" ? (
        answer === true ? (
          <Badge className="bg-primary/10 text-primary">
            {tc("yes")}
          </Badge>
        ) : answer === false ? (
          <Badge className="bg-muted text-muted-foreground">
            {tc("no")}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {tc("unknown")}
          </Badge>
        )
      ) : Array.isArray(answer) ? (
        <div className="flex flex-wrap gap-2">
          {answer.map((item) => <Badge key={String(item)} variant="outline">{item}</Badge>)}
        </div>
      ) : (
        <div className="text-sm">{String(answer)}</div>
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
    </div>
  );
}

function CitationPreview({
  citation,
  onClick,
}: {
  citation: CitationLocation;
  onClick: () => void;
}) {
  const tc = useTranslations("common");
  return (
    <div
      role="button"
      tabIndex={0}
      className="bg-muted/30 rounded-lg border border-border/40 p-3 space-y-2 cursor-pointer hover:bg-muted/50"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{tc("citation")}</span>
        <Quote className="w-3 h-3 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground line-clamp-4">
        {citation.text}
      </p>
      <Button variant="link" size="sm" className="h-auto p-0 text-xs">{tc("viewInPdf")}</Button>
    </div>
  );
}
