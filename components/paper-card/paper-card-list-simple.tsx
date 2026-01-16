"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { workToCoins } from "@/lib/utils";
import { useUIStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";
import { useIsTablet } from "@/lib/hooks";
import { openFocusMode } from "@/lib/search-actions";
import { RatingSelector } from "@/components/rating-selector";
import { Quote } from "lucide-react";
import { useTranslate, useCitationHandlers } from "./hooks";
import { cn } from "@/lib/utils";
import {
  PaperCardProps,
  CardContainer,
  OpenAccessBadge,
  DOIBadge,
  truncateAuthors,
  DownloadMenuCompact,
  TranslationToggle,
  ScreeningResponses,
} from "./shared";
export function PaperCardListSimple({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
}: PaperCardProps) {
  const pathname = usePathname();
  const { isFocusModeOpen } = useUIStore();
  const isMobile = useIsTablet();

  const { handleCitesSearch } = useCitationHandlers(result.id);

  const { 
    translatedContent, 
    showTranslated, 
    isTranslating, 
    setShowTranslated,
    selectedLanguage 
  } = useTranslate(result);

  const displayTitle = showTranslated && translatedContent
    ? translatedContent.translatedTitle
    : result.title;

  const authors = result.authorships
    ? truncateAuthors(result.authorships, 60)
    : "";

  const journal = result.primary_location?.source?.display_name || "";

  return (
    <CardContainer className="overflow-hidden">
      {/* COINS metadata span */}
      {!isFocusModeOpen && (
        <span
          className="Z3988"
          title={workToCoins(result)}
          style={{ display: "none" }}
        />
      )}
      
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
            <div 
              className="hidden @md/card:flex items-center gap-1 flex-wrap flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <ScreeningResponses data={result} variant="icons-only" />
            </div>

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
                  handleCitesSearch();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    handleCitesSearch();
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
              <TranslationToggle
                isTranslating={isTranslating}
                translatedContent={translatedContent}
                showTranslated={showTranslated}
                selectedLanguage={selectedLanguage}
                setShowTranslated={setShowTranslated}
                variant="compact"
              />
              <OpenAccessBadge
                isOA={result.open_access?.is_oa}
                oaUrl={result.open_access?.oa_url}
                compact
              />
              <DOIBadge doi={result.doi} compact />
              <DownloadMenuCompact
                onDownloadJSON={() => onDownloadItem(result, "json")}
                onDownloadCSV={() => onDownloadItem(result, "csv")}
                onDownloadEssentialJSON={() => onDownloadEssentialItem(result, "json")}
                onDownloadEssentialCSV={() => onDownloadEssentialItem(result, "csv")}
              />
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
