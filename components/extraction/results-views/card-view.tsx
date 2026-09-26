"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { getAllCitationLocations, getCitationStatus } from "@/lib/extraction/citations";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { buildCitationPanelPayload } from "@/lib/extraction/citation-panel";
import { answeredConfidence, ConfidenceValue, PaperDetails, ResultCell } from "./result-parts";

interface CardViewProps {
  papers: PaperWithResults[];
  questions: Question[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  onOpenCitationPanel: (payload: CitationPanelPayload) => void;
}

export const CardView = memo(function CardView({
  papers,
  questions,
  selectedIds,
  onSelectionChange,
  onOpenCitationPanel,
}: CardViewProps) {
  const t = useTranslations("extraction");
  const pdfEnabled = useFeatureFlag("extraction.pdf");
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
    <ul className="divide-y divide-border/50">
      {papers.map((paper) => {
        const isSelected = selectedIds.has(paper._id);
        const confidence = answeredConfidence(paper);
        return (
          <li
            key={paper._id}
            data-paper-id={paper._id}
            data-state={isSelected ? "selected" : undefined}
            className="group cursor-pointer space-y-4 p-4 transition-colors hover:bg-muted/30 data-[state=selected]:bg-muted/50 md:px-6"
            onClick={() => toggleSelect(paper._id)}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleSelect(paper._id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={paper.title}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="line-clamp-2 text-sm font-medium leading-snug" title={paper.title}>{paper.title}</p>
                <PaperDetails paper={paper} pdfEnabled={pdfEnabled} />
              </div>
              {confidence !== undefined ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  <ConfidenceValue value={confidence} /> {t("confidence")}
                </span>
              ) : null}
            </div>
            <dl className="grid gap-x-8 gap-y-4 pl-7 sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
              {questions.map((q) => {
                const result = paper.results.find((r) => r.questionKey === q.key);
                return (
                  <div key={q.key} className="min-w-0 space-y-1">
                    <dt className="text-xs text-muted-foreground">{q.question}</dt>
                    <dd>
                      <ResultCell
                        question={q.question}
                        result={result}
                        type={q.type}
                        clamp="line-clamp-4"
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
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.papers === nextProps.papers &&
    prevProps.questions === nextProps.questions &&
    prevProps.selectedIds === nextProps.selectedIds &&
    prevProps.onOpenCitationPanel === nextProps.onOpenCitationPanel
  );
});
