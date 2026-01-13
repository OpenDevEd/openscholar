"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useIsTablet } from "@/lib/hooks";
import { openFocusMode } from "@/lib/search-actions";
import { createCitationSearch } from "@/lib/search";
import { RatingSelector } from "@/components/rating-selector";
import { Quote, Network, Users, BookOpen } from "lucide-react";
import { useTranslate, useScreening } from "@/components/paper-card.legacy";
import { cn } from "@/lib/utils";
import {
  PaperCardProps,
  CardContainer,
  OpenAccessBadge,
  DOIBadge,
  getFirstAuthor,
  ScreeningBadge,
} from "./shared";

function finalState(
  isQuestionAnswered: boolean | null,
  isQuestionLoading: boolean,
  isQuestionMissing: boolean
): "checked" | "crossed" | "unchecked" | "loading" {
  if (isQuestionLoading) return "loading";
  if (isQuestionMissing) return "unchecked";
  if (isQuestionAnswered != null)
    return isQuestionAnswered === true
      ? "checked"
      : isQuestionAnswered === false
        ? "crossed"
        : "unchecked";
  return "unchecked";
}

export function PaperCardGrid({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
  viewMode = "grid-2",
}: PaperCardProps) {
  const router = useRouter();
  const isMobile = useIsTablet();

  const handleFilteredSearch = (filterType: "cites" | "citedBy" | "related") => {
    const { url } = createCitationSearch(result.id, filterType);
    router.push(url);
  };

  const { translatedContent, showTranslated } = useTranslate(result);

  const {
    screeningQuestions,
    myExistingResponses,
    myLoadingResponses,
    myMissingResponses,
  } = useScreening(result);

  const displayTitle = showTranslated && translatedContent
    ? translatedContent.translatedTitle
    : result.title;

  const author = result.authorships ? getFirstAuthor(result.authorships) : "";
  const journal = result.primary_location?.source?.display_name || "";

  const isCompact = viewMode === "grid-3";

  return (
    <CardContainer className="overflow-hidden h-full flex flex-col">
      <button
        onClick={() => openFocusMode(isMobile, resultIndex)}
        className="flex-1 w-full text-left flex flex-col"
      >
        <div className={cn("flex flex-col h-full", isCompact ? "p-3" : "p-4")}>
          {/* Header: Year badge and quick actions */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium",
              "bg-primary/10 text-primary"
            )}>
              {result.publication_year}
            </span>
            
            <div 
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <OpenAccessBadge
                isOA={result.open_access?.is_oa}
                oaUrl={result.open_access?.oa_url}
                compact
              />
              <DOIBadge doi={result.doi} compact />
            </div>
          </div>

          {/* Title */}
          <h3 className={cn(
            "font-semibold leading-snug text-wrap-anywhere group-hover:text-primary transition-colors mb-2",
            isCompact ? "text-sm line-clamp-2" : "text-base line-clamp-3"
          )}>
            {displayTitle}
          </h3>

          {/* Author */}
          {author && (
            <div className={cn(
              "flex items-center gap-1.5 text-muted-foreground mb-1.5",
              isCompact ? "text-xs" : "text-sm"
            )}>
              <Users className={cn(isCompact ? "h-3 w-3" : "h-3.5 w-3.5", "flex-shrink-0")} />
              <span className="line-clamp-1">{author}</span>
            </div>
          )}

          {/* Journal - hidden in compact mode */}
          {journal && !isCompact && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              <BookOpen className="h-3 w-3 flex-shrink-0" />
              <span className="line-clamp-1 italic">{journal}</span>
            </div>
          )}

          {/* Screening badges - icon only */}
          {screeningQuestions.length > 0 && (
            <div 
              className="flex items-center gap-1 flex-wrap mb-2"
              onClick={(e) => e.stopPropagation()}
            >
              {screeningQuestions.map((question, index) => {
                const isQuestionAnswered = myExistingResponses[question.question];
                const isQuestionLoading = myLoadingResponses[question.question];
                const isQuestionMissing = myMissingResponses.includes(question.question);
                const displayState = finalState(isQuestionAnswered, isQuestionLoading, isQuestionMissing);

                return (
                  <ScreeningBadge
                    key={index}
                    displayState={displayState}
                    index={index}
                    question={question.question}
                    variant="icon-only"
                  />
                );
              })}
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Footer: Rating and citations */}
          <div 
            className="flex items-center justify-between pt-3 mt-auto border-t border-border/50"
            onClick={(e) => e.stopPropagation()}
          >
            <RatingSelector paperId={result.id} variant="compact" />
            
            <div className="flex items-center gap-2">
              {/* Cited by count */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFilteredSearch("cites");
                }}
                className={cn(
                  "flex items-center gap-1 rounded-lg font-medium transition-colors",
                  "text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/50",
                  isCompact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"
                )}
                title={`Cited by ${result.cited_by_count || 0}`}
              >
                <Quote className={cn(isCompact ? "h-3 w-3" : "h-3.5 w-3.5")} />
                <span>{result.cited_by_count || 0}</span>
              </button>

              {/* Related count - hidden in compact */}
              {!isCompact && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFilteredSearch("related");
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors"
                  title={`Related: ${result.related_works?.length || 0}`}
                >
                  <Network className="h-3.5 w-3.5" />
                  <span>{result.related_works?.length || 0}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </button>
    </CardContainer>
  );
}
