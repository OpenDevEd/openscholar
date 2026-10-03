"use client";

import { CitationControl } from "@/components/citation-control";

import React from "react";
import { usePathname } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { workToCoins } from "@/lib/utils";
import { useUIStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";
import { useIsTablet } from "@/lib/hooks";
import { openFocusMode } from "@/lib/search-actions";
import { RatingSelector } from "@/components/rating-selector";
import { SaveControl } from "@/components/library/save-control";
import { TooltipHint } from "@/components/ui/tooltip";
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
  hide,
}: PaperCardProps) {
  const pathname = usePathname();
  const tp = useTranslations("paperCard");
  const format = useFormatter();
  const { isFocusModeOpen } = useUIStore();
  const isMobile = useIsTablet();

  const { handleCitesSearch } = useCitationHandlers(result.id);

  const { 
    translatedContent, 
    showTranslated, 
    isTranslating, 
    setShowTranslated
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
        role={hide?.focusMode ? undefined : "button"}
        tabIndex={hide?.focusMode ? undefined : 0}
        onClick={hide?.focusMode ? undefined : () => openFocusMode(isMobile, resultIndex, result.id)}
        onKeyDown={hide?.focusMode ? undefined : (e) => e.key === "Enter" && openFocusMode(isMobile, resultIndex, result.id)}
        className={cn("w-full text-left", !hide?.focusMode && "cursor-pointer")}
      >
        <div className="flex items-center gap-3 p-3 @sm/card:p-4">
          {/* Rating - always visible */}
          <div
            role="group"
            className="flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {!hide?.rating && (
              <div className="flex items-center gap-2">
                <RatingSelector paper={result} variant="compact" />
                <SaveControl paper={result} compact />
              </div>
            )}
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
              role="group"
              className="hidden @md/card:flex items-center gap-1 flex-wrap flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <ScreeningResponses data={result} variant="icons-only" />
            </div>

            {/* Citation count badge */}
            <div
              role="group"
              className="hidden @sm/card:flex items-center gap-1 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <TooltipHint label={tp("citedByCount", { count: format.number(result.cited_by_count ?? 0) })}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCitesSearch();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCitesSearch();
                    }
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ink-cites hover:bg-cites/10 transition-colors cursor-pointer"
                >
                  <Quote className="h-3 w-3" />
                  <span>{format.number(result.cited_by_count ?? 0)}</span>
                </div>
              </TooltipHint>
            </div>

            {/* Quick actions */}
            <div
              role="group"
              className="hidden @md/card:flex items-center gap-1 flex-shrink-0"
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

          <CitationControl paper={result} />

          {/* Mobile citation count */}
          <div
            role="group"
            className="@sm/card:hidden flex items-center gap-1 flex-shrink-0 text-xs ink-cites"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Quote className="h-3 w-3" />
            <span className="font-medium">{format.number(result.cited_by_count ?? 0)}</span>
          </div>
        </div>
      </div>
    </CardContainer>
  );
}
