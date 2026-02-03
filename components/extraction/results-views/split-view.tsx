"use client";

import { useState, useMemo, memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Quote, ExternalLink, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import { getAvgConfidence } from "@/lib/extraction/filtering";
import { PdfCitationDrawer } from "@/components/extraction/pdf-citation-drawer";

interface SplitViewProps {
  papers: PaperWithResults[];
  questions: Question[];
}

export const SplitView = memo(function SplitView({ papers, questions }: SplitViewProps) {
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(
    papers.length > 0 ? papers[0]._id : null
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPaperId, setDrawerPaperId] = useState<Doc<"extractionPapers">["_id"] | null>(null);
  const [drawerPaperTitle, setDrawerPaperTitle] = useState<string | null>(null);
  const [drawerCitation, setDrawerCitation] = useState<string | null>(null);
  const [drawerAnswerText, setDrawerAnswerText] = useState<string | null>(null);
  const [drawerQuestionText, setDrawerQuestionText] = useState<string | null>(null);

  const selectedPaper = papers.find(p => p._id === selectedPaperId);

  return (
    <>
      <PdfCitationDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        paperId={drawerPaperId}
        paperTitle={drawerPaperTitle}
        citationChunk={drawerCitation}
        answerText={drawerAnswerText}
        questionText={drawerQuestionText}
      />

      <div className="rounded-xl border border-border/40 overflow-hidden bg-card/50 shadow-sm h-[calc(100vh-400px)] min-h-[500px] max-h-[800px]">
        <div className="flex h-full">
          {/* Left: Paper list */}
          <div className="w-[320px] min-w-[320px] border-r border-border/40 overflow-y-auto bg-muted/30 h-full">
            {papers.map(paper => {
              const avgConfidence = getAvgConfidence(paper);
              const isSelected = selectedPaperId === paper._id;

              return (
                <div
                  key={paper._id}
                  onClick={() => setSelectedPaperId(paper._id)}
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
          <div className="flex-1 overflow-y-auto p-6 bg-card/30 h-full">
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
                    return (
                      <div key={q.key} className="bg-card rounded-lg border border-border/40 p-4">
                        <h3 className="font-medium text-sm mb-3">{q.question}</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr,280px] gap-4">
                          <div className="space-y-2">
                            <ResultValue result={result} type={q.type} />
                            {result?.reasoning && (
                              <p className="text-xs text-muted-foreground mt-2 bg-muted/50 p-2 rounded">
                                {result.reasoning}
                              </p>
                            )}
                          </div>
                          {result?.contextChunks?.[0] && (
                            <CitationPreview
                              chunk={result.contextChunks[0]}
                              onClick={() => {
                                setDrawerPaperId(selectedPaper._id);
                                setDrawerPaperTitle(selectedPaper.title);
                                setDrawerCitation(result.contextChunks![0]);
                                const answerText = Array.isArray(result.answer)
                                  ? result.answer
                                      .filter((item) => typeof item === "string")
                                      .sort((a, b) => b.length - a.length)[0]
                                  : result.answer !== null && result.answer !== undefined
                                    ? String(result.answer)
                                    : null;
                                setDrawerAnswerText(answerText ?? null);
                                setDrawerQuestionText(q.question);
                                setDrawerOpen(true);
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
                <p className="text-sm text-muted-foreground">Select a paper to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}, (prevProps, nextProps) => {
  return prevProps.papers === nextProps.papers && prevProps.questions === nextProps.questions;
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
  if (!result) return <span className="text-muted-foreground/50 text-sm">No result</span>;
  
  const { answer } = result;

  return (
    <div className="text-sm">
      {type === "boolean" ? (
        <Badge className={cn(answer ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {answer ? "Yes" : "No"}
        </Badge>
      ) : Array.isArray(answer) ? (
        <div className="flex flex-wrap gap-2">
          {answer.map((item, i) => <Badge key={i} variant="outline">{item}</Badge>)}
        </div>
      ) : (
        <div className="text-sm">{String(answer)}</div>
      )}
    </div>
  );
}

function CitationPreview({ chunk, onClick }: { chunk: string; onClick: () => void }) {
  return (
    <div className="bg-muted/30 rounded-lg border border-border/40 p-3 space-y-2 cursor-pointer hover:bg-muted/50" onClick={onClick}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Citation</span>
        <Quote className="w-3 h-3 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground line-clamp-4">{chunk}</p>
      <Button variant="link" size="sm" className="h-auto p-0 text-xs">View in PDF</Button>
    </div>
  );
}
