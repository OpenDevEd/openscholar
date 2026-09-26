"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { openAnswerKey, type OpenAnswer } from "@/components/extraction/answer-panel";
import { PaperDetails, ResultCell } from "./result-parts";
import { CircleDashed, CircleX } from "lucide-react";
import { getCitationStatus } from "@/lib/extraction/citations";

interface CardViewProps {
  papers: PaperWithResults[];
  questions: Question[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  onOpenAnswer: (answer: OpenAnswer) => void;
  /** The answer open in the side panel, to highlight its cell. */
  openAnswer?: string | null;
}

export const CardView = memo(function CardView({
  papers,
  questions,
  selectedIds,
  onSelectionChange,
  onOpenAnswer,
  openAnswer,
}: CardViewProps) {
  const tc = useTranslations("common");
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
    <ul className="grid gap-4 p-4 md:p-6 @4xl:grid-cols-2">
      {papers.map((paper) => {
        const isSelected = selectedIds.has(paper._id);
        const resultFor = (question: Question) => paper.results.find((r) => r.questionKey === question.key);
        const hasAnswer = (question: Question) => {
          const answer = resultFor(question)?.answer;
          return answer !== undefined && answer !== null && answer !== "" && !(Array.isArray(answer) && !answer.length);
        };
        const answered = questions.filter(hasAnswer);
        const unanswered = questions.filter((question) => !hasAnswer(question) && resultFor(question));
        const failed = unanswered.filter((question) => getCitationStatus(resultFor(question)) === "extraction_error");
        const missing = unanswered.filter((question) => !failed.includes(question));
        const chips = (group: Question[]) => group.map((question) => (
          <button
            key={question.key}
            type="button"
            aria-pressed={openAnswer === openAnswerKey({ paper, question })}
            onClick={() => onOpenAnswer({ paper, question, result: resultFor(question) })}
            className="max-w-full truncate rounded-md bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground aria-pressed:bg-primary/10 aria-pressed:text-foreground"
          >
            {question.question}
          </button>
        ));
        return (
          <li
            key={paper._id}
            data-paper-id={paper._id}
            data-state={isSelected ? "selected" : undefined}
            className="flex flex-col rounded-xl border border-border/50 bg-card/50 transition-colors data-[state=selected]:border-primary/40 dark:bg-card/40"
          >
            {/* The paper */}
            <div className="flex items-start gap-3 border-b border-border/40 p-4">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleSelect(paper._id)}
                aria-label={paper.title}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="line-clamp-2 text-sm font-medium leading-snug" title={paper.title}>{paper.title}</p>
                <PaperDetails paper={paper} pdfEnabled={pdfEnabled} />
              </div>
            </div>

            {/* Its answers, each opening the side panel */}
            {answered.length ? (
              <dl className="flex-1 space-y-3 p-4">
                {answered.map((question) => {
                  const result = resultFor(question);
                  return (
                    <div key={question.key} className="space-y-1">
                      <dt className="truncate text-xs text-muted-foreground" title={question.question}>{question.question}</dt>
                      <dd>
                        <ResultCell
                          result={result}
                          type={question.type}
                          clamp="line-clamp-3"
                          selected={openAnswer === openAnswerKey({ paper, question, result })}
                          onOpen={() => onOpenAnswer({ paper, question, result })}
                        />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : <div className="flex-1" />}

            {/* Questions without an answer, grouped so they don't repeat down the card */}
            {missing.length || failed.length ? (
              <div className="space-y-2 border-t border-border/40 px-4 py-3">
                {missing.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CircleDashed aria-hidden className="size-3.5" />
                      {tc("insufficientEvidence")}
                    </span>
                    {chips(missing)}
                  </div>
                ) : null}
                {failed.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-destructive">
                      <CircleX aria-hidden className="size-3.5" />
                      {tc("extractionError")}
                    </span>
                    {chips(failed)}
                  </div>
                ) : null}
              </div>
            ) : null}
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
    prevProps.onOpenAnswer === nextProps.onOpenAnswer &&
    prevProps.openAnswer === nextProps.openAnswer
  );
});
