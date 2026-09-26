"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ExtractionResultRecord, PaperWithResults, Question } from "@/lib/extraction/filtering";
import { getAllCitationLocations, getCitationStatus } from "@/lib/extraction/citations";
import { buildCitationPanelPayload } from "@/lib/extraction/citation-panel";
import { PdfCitationPanel } from "./pdf-citation-panel";
import { ResultAnswer, ResultMeta } from "./results-views/result-parts";

/** The answer a reader opened from the results: which paper, which question, and what came back. */
export type OpenAnswer = {
  paper: PaperWithResults;
  question: Question;
  result?: ExtractionResultRecord;
};

export const openAnswerKey = (answer: OpenAnswer | null) => (answer ? `${answer.paper._id}:${answer.question.key}` : null);

/**
 * The side panel for one answer: the full answer, how far to trust it and why,
 * then the passage in the paper that backs it, when there is one.
 */
export function AnswerPanel({ answer }: { answer: OpenAnswer | null }) {
  const t = useTranslations();
  if (!answer) return <PdfCitationPanel payload={null} />;
  const { paper, question, result } = answer;
  const citations = getAllCitationLocations(result);
  const citation = result
    ? buildCitationPanelPayload({
        paperId: paper._id,
        paperTitle: paper.title,
        citations,
        citationStatus: getCitationStatus(result),
        answer: result.answer,
        questionText: question.question,
      })
    : null;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* With a citation below, the details share the height with the PDF. */}
      <section className={cn("shrink-0 space-y-3 overflow-y-auto rounded-xl border border-border/60 bg-card p-4", citation && "max-h-[50%]")}>
        {/* Room on the right for the panel's collapse button. */}
        <div className="space-y-1 pr-10">
          <p className="text-sm font-medium leading-snug">{paper.title}</p>
          <p className="text-xs text-muted-foreground">{question.question}</p>
        </div>
        <ResultAnswer result={result} type={question.type} clamp="" />
        <ResultMeta result={result} />
        {result?.reasoning ? (
          <div className="space-y-1 border-t border-border/50 pt-3">
            <p className="text-xs font-medium">{t("common.reasoning")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{result.reasoning}</p>
          </div>
        ) : null}
      </section>
      {citation ? (
        <div className="min-h-0 flex-1">
          <PdfCitationPanel key={`${paper._id}-${question.key}`} payload={citation} />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
          {t("pdfViewer.citationUnavailable")}
        </p>
      )}
    </div>
  );
}
