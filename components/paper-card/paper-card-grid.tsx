"use client";

import { CitationControl } from "@/components/citation-control";

import React from "react";
import { usePathname } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { workToCoins } from "@/lib/utils";
import { useUIStore } from "@/lib/store";
import { useIsTablet } from "@/lib/hooks";
import { openFocusMode } from "@/lib/search-actions";
import { RatingSelector } from "@/components/rating-selector";
import { SaveControl } from "@/components/library/save-control";
import { TooltipHint } from "@/components/ui/tooltip";
import { Quote, Network, Users, BookOpen } from "@/components/icons";
import { useTranslate, useScreening, useCitationHandlers } from "./hooks";
import { cn } from "@/lib/utils";
import {
  PaperCardProps,
  CardContainer,
  OpenAccessBadge,
  DOIBadge,
  getFirstAuthor,
  ScreeningBadge,
  finalState,
  DownloadMenuCompact,
  TranslationToggle,
} from "./shared";

export function PaperCardGrid({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
  hide,
  viewMode = "grid-2",
}: PaperCardProps) {
  const pathname = usePathname();
  const tp = useTranslations("paperCard");
  const format = useFormatter();
  const { isFocusModeOpen } = useUIStore();
  const isMobile = useIsTablet();

  const { handleCitesSearch, handleRelatedSearch } = useCitationHandlers(result.id);

  const { 
    translatedContent, 
    showTranslated, 
    isTranslating, 
    setShowTranslated
  } = useTranslate(result);

  const {
    screeningQuestions,
    myExistingResponses,
    myLoadingQuestions,
    myMissingResponses,
    isScreeningPanelOpen,
  } = useScreening(result);

  const displayTitle = showTranslated && translatedContent
    ? translatedContent.translatedTitle
    : result.title;

  const author = result.authorships ? getFirstAuthor(result.authorships) : "";
  const journal = result.primary_location?.source?.display_name || "";

  const isCompact = viewMode === "grid-3";

  return (
    <CardContainer className="overflow-hidden h-full flex flex-col">
      {/* COINS metadata span */}
      {!isFocusModeOpen && (
        <span
          className="Z3988"
          title={workToCoins(result)}
          style={{ display: "none" }}
        />
      )}
      
      <div
        role={hide?.focusMode ? undefined : "button"}
        tabIndex={hide?.focusMode ? undefined : 0}
        onClick={hide?.focusMode ? undefined : () => openFocusMode(isMobile, resultIndex, result.id)}
        onKeyDown={hide?.focusMode ? undefined : (e) => e.key === "Enter" && openFocusMode(isMobile, resultIndex, result.id)}
        className={cn("flex-1 w-full text-left flex flex-col", !hide?.focusMode && "cursor-pointer")}
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
              role="group"
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <TranslationToggle
                isTranslating={isTranslating}
                translatedContent={translatedContent}
                showTranslated={showTranslated}
                setShowTranslated={setShowTranslated}
                variant="compact"
              />
              <OpenAccessBadge
                isOA={result.open_access?.is_oa}
                oaUrl={result.open_access?.oa_url}
                compact
              />
              <DOIBadge doi={result.doi} compact />
              <CitationControl paper={result} />
              {!hide?.download && (
                <DownloadMenuCompact
                  onDownloadJSON={() => onDownloadItem(result, "json")}
                  onDownloadCSV={() => onDownloadItem(result, "csv")}
                  onDownloadEssentialJSON={() => onDownloadEssentialItem(result, "json")}
                  onDownloadEssentialCSV={() => onDownloadEssentialItem(result, "csv")}
                />
              )}
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

          {/* Screening badges - icon only. Hidden when the screening
              panel is collapsed so the badges don't dangle as
              orphaned UI when there's no panel context. */}
          {isScreeningPanelOpen && screeningQuestions.length > 0 && (
            <div
              role="group"
              className="flex items-center gap-1 flex-wrap mb-2"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {screeningQuestions.map((question, index) => {
                const isQuestionAnswered = myExistingResponses[question.question];
                const isQuestionLoading = myLoadingQuestions.has(question.question);
                const isQuestionMissing = myMissingResponses.includes(question.question);
                const displayState = finalState(isQuestionAnswered, isQuestionLoading, isQuestionMissing);

                return (
                  <ScreeningBadge
                    key={question.question}
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
            role="group"
            className="flex flex-wrap items-center gap-2 pt-3 mt-auto border-t border-border/50"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* Narrow cards give the rating its own row; the breakpoints fit five stars, save and the counts */}
            {!hide?.rating && (
              <>
                <div
                  className={cn(
                    "basis-full",
                    isCompact
                      ? "@min-[18.5rem]/card:basis-auto"
                      : "@min-[22.5rem]/card:basis-auto",
                  )}
                >
                  <RatingSelector paper={result} variant="compact" />
                </div>
                <SaveControl paper={result} compact />
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              {/* Cited by count */}
              <TooltipHint label={tp("citedByCount", { count: format.number(result.cited_by_count ?? 0) })}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCitesSearch();
                  }}
                  className={cn(
                    "flex items-center gap-1 rounded-lg font-medium transition-colors",
                    "ink-cites hover:bg-cites/10",
                    isCompact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"
                  )}
                >
                  <Quote className={cn(isCompact ? "h-3 w-3" : "h-3.5 w-3.5")} />
                  <span>{format.number(result.cited_by_count ?? 0)}</span>
                </button>
              </TooltipHint>

              {/* Related count - hidden in compact */}
              {!isCompact && (
                <TooltipHint label={tp("relatedCount", { count: format.number(result.related_works?.length ?? 0) })}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRelatedSearch();
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium ink-related hover:bg-related/10 transition-colors"
                  >
                    <Network className="h-3.5 w-3.5" />
                    <span>{format.number(result.related_works?.length ?? 0)}</span>
                  </button>
                </TooltipHint>
              )}
            </div>
          </div>
        </div>
      </div>
    </CardContainer>
  );
}
