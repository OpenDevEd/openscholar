"use client";

import React, { useContext } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUIStore, useSearchHistoryStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";
import { useIsTablet } from "@/lib/hooks";
import { openFocusMode } from "@/lib/search-actions";
import { createCitationSearch } from "@/lib/search";
import { RatingSelector } from "@/components/rating-selector";
import { Quote, Network } from "lucide-react";
import { useTranslate, useScreening } from "@/components/paper-card.legacy";
import { cn } from "@/lib/utils";
import {
  PaperCardProps,
  CardContainer,
  OpenAccessBadge,
  DOIBadge,
  truncateAuthors,
  ScreeningBadge,
} from "./shared";
import { ScreeningContext } from "@/components/results-list";

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

export function PaperCardListSimple({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
}: PaperCardProps) {
  const router = useRouter();
  const pathname = usePathname();
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

  const authors = result.authorships
    ? truncateAuthors(result.authorships, 60)
    : "";

  const journal = result.primary_location?.source?.display_name || "";

  return (
    <CardContainer className="overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => openFocusMode(isMobile, resultIndex)}
        onKeyDown={(e) => e.key === "Enter" && openFocusMode(isMobile, resultIndex)}
        className="w-full text-left cursor-pointer"
      >
        <div className="flex items-center gap-3 p-3 @sm/card:p-4">
          {/* Rating - always visible */}
          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <RatingSelector paperId={result.id} variant="compact" />
          </div>

          {/* Main content area */}
          <div className="flex-1 min-w-0 flex flex-col @sm/card:flex-row @sm/card:items-center gap-1 @sm/card:gap-3">
            {/* Title and year */}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm leading-tight line-clamp-1 group-hover:text-primary transition-colors">
                {displayTitle}
                <span className="ml-1.5 text-muted-foreground font-normal">
                  ({result.publication_year})
                </span>
              </h3>
              
              {/* Authors and journal - hidden on smallest, visible on @sm */}
              <p className="hidden @sm/card:block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {authors && <span>{authors}</span>}
                {authors && journal && <span className="mx-1.5">·</span>}
                {journal && <span className="italic">{journal}</span>}
              </p>
            </div>

            {/* Screening badges - icon only */}
            {screeningQuestions.length > 0 && (
              <div 
                className="hidden @md/card:flex items-center gap-1 flex-wrap flex-shrink-0"
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

            {/* Citation count badge */}
            <div 
              className="hidden @sm/card:flex items-center gap-1 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  handleFilteredSearch("cites");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    handleFilteredSearch("cites");
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/50 transition-colors cursor-pointer"
                title={`Cited by ${result.cited_by_count || 0}`}
              >
                <Quote className="h-3 w-3" />
                <span>{result.cited_by_count || 0}</span>
              </div>
            </div>

            {/* Quick actions */}
            <div 
              className="hidden @md/card:flex items-center gap-1 flex-shrink-0"
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

          {/* Mobile citation count */}
          <div 
            className="@sm/card:hidden flex items-center gap-1 flex-shrink-0 text-xs text-orange-600 dark:text-orange-400"
            onClick={(e) => e.stopPropagation()}
          >
            <Quote className="h-3 w-3" />
            <span className="font-medium">{result.cited_by_count || 0}</span>
          </div>
        </div>
      </div>
    </CardContainer>
  );
}
