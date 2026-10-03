"use client";

import { useState, memo } from "react";
import { useTranslations } from "next-intl";
import { Quote, FileText } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import {
  getAllCitationLocations,
  getCitationStatus,
} from "@/lib/extraction/citations";
import type { CitationLocation } from "@/lib/extraction/citations";
import type { OpenAnswer } from "@/components/extraction/answer-panel";
import { answeredConfidence, ConfidenceValue, PaperDetails, ResultAnswer, ResultMeta } from "./result-parts";

interface SplitViewProps {
  papers: PaperWithResults[];
  questions: Question[];
  onOpenAnswer: (answer: OpenAnswer) => void;
}

export const SplitView = memo(function SplitView({ papers, questions, onOpenAnswer }: SplitViewProps) {
  const t = useTranslations("extraction");
  const pdfEnabled = useFeatureFlag("extraction.pdf");
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(
    papers.length > 0 ? papers[0]._id : null
  );

  const selectedPaper = papers.find(p => p._id === selectedPaperId);

  return (
    <div className="flex h-[calc(100dvh-300px)] min-h-[480px] min-w-0 flex-col lg:flex-row">
      {/* Papers */}
      <ul className="h-56 w-full shrink-0 divide-y divide-border/50 overflow-y-auto border-b border-border/50 lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
        {papers.map((paper) => {
          const isSelected = selectedPaperId === paper._id;
          return (
            <li key={paper._id}>
              <button
                type="button"
                aria-current={isSelected || undefined}
                onClick={() => setSelectedPaperId(paper._id)}
                className={cn("w-full space-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/40", isSelected && "bg-muted hover:bg-muted")}
              >
                <p className="line-clamp-2 text-sm font-medium leading-snug">{paper.title}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {paper.publicationYear ? <span className="tabular-nums">{paper.publicationYear}</span> : null}
                  {answeredConfidence(paper) !== undefined ? <ConfidenceValue value={answeredConfidence(paper)!} /> : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* The chosen paper's answers */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selectedPaper ? (
          <div className="divide-y divide-border/50">
            <div className="space-y-1.5 p-4 md:px-6">
              <h2 className="text-base font-semibold leading-snug">{selectedPaper.title}</h2>
              <PaperDetails paper={selectedPaper} pdfEnabled={pdfEnabled} />
            </div>
            {questions.map((q) => {
              const result = selectedPaper.results.find((r) => r.questionKey === q.key);
              const citations = getAllCitationLocations(result);
              return (
                // The citation column exists only when there is a citation to show.
                <section key={q.key} className={cn("grid gap-4 p-4 md:px-6", citations.length > 0 && result && "xl:grid-cols-[1fr_280px]")}>
                  <div className="min-w-0 space-y-2">
                    <h3 className="text-xs text-muted-foreground">{q.question}</h3>
                    <ResultAnswer result={result} type={q.type} clamp="" />
                    <ResultMeta result={result} />
                    {result?.reasoning ? <p className="text-xs leading-relaxed text-muted-foreground">{result.reasoning}</p> : null}
                  </div>
                  {citations.length > 0 && result ? (
                    <CitationPreview
                      citation={citations[0]}
                      onClick={() => onOpenAnswer({ paper: selectedPaper, question: q, result })}
                    />
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <FileText className="mb-3 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("selectPaperToView")}</p>
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.papers === nextProps.papers &&
    prevProps.questions === nextProps.questions &&
    prevProps.onOpenAnswer === nextProps.onOpenAnswer
  );
});

function CitationPreview({
  citation,
  onClick,
}: {
  citation: CitationLocation;
  onClick: () => void;
}) {
  const tc = useTranslations("common");
  return (
    <button
      type="button"
      className="w-full space-y-2 rounded-lg bg-muted/40 p-3 text-left transition-colors hover:bg-muted/70"
      onClick={onClick}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Quote className="size-3" />
        {tc("citation")}
      </span>
      <span className="line-clamp-4 block text-xs leading-relaxed text-muted-foreground">{citation.text}</span>
      <span className="block text-xs font-medium text-primary">{tc("viewInPdf")}</span>
    </button>
  );
}
