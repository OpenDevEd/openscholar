"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
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
import { MIN_ABSTRACT_LENGTH } from "@/convex/extraction/content";
import { extractionFeatureFlags } from "@/lib/extraction/feature-flags";
import {
  getAllCitationLocations,
  getCitationStatus,
} from "@/lib/extraction/citations";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { buildCitationPanelPayload } from "@/lib/extraction/citation-panel";
import { getReviewLabel, getReviewState, isReviewed } from "@/lib/extraction/reviews";

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
  const tc = useTranslations("common");
  const pdfEnabled = extractionFeatureFlags.pdf;
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
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
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
          const reviewedCount = paper.results.filter((result) => isReviewed(result)).length;

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
                        {reviewedCount > 0 ? (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9px] bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
                          >
                            {t("reviewed", { count: reviewedCount, total: paper.results.length })}
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
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
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

function ResultValue({ result, type }: { result?: Doc<"extractionResults">; type: string }) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  if (!result) {
    return <span className="text-muted-foreground/30 text-xs">—</span>;
  }

  const { answer, confidence } = result;
  const citationStatus = getCitationStatus(result);
  const reviewState = getReviewState(result);
  const reviewLabel = getReviewLabel(reviewState);

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
              <Badge key={String(item)} variant="outline" className="text-xs font-normal">
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
  const tc = useTranslations("common");
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
              <h4 className="font-medium">{tc("reasoning")}</h4>
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
          title={tc("viewCitation")}
        >
          <Quote className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}
