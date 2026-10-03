"use client";
import { TopicLink } from "@/components/topics/topic-link";

import { CitationControl } from "@/components/citation-control";

import React, { useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { workToCoins } from "@/lib/utils";
import { useResultsStore, useUIStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";
import { useIsTablet } from "@/lib/hooks";
import { openFocusMode } from "@/lib/search-actions";
import { createCitationSearch } from "@/lib/search";
import { RatingSelector } from "@/components/rating-selector";
import { SaveControl } from "@/components/library/save-control";
import { DownloadMenu } from "@/components/download-menu";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Award,
  Target,
  Layers,
  Building,
  Leaf,
  BarChart3,
  FileText,
  Quote,
  Network,
  BookOpen,
} from "lucide-react";
import { TooltipHint } from "@/components/ui/tooltip";
import { useTranslate } from "./hooks";
import { cn } from "@/lib/utils";
import {
  PaperCardProps,
  CardContainer,
  AuthorsLine,
  JournalLine,
  CitationBadge,
  OpenAccessBadge,
  DOIBadge,
  ScreeningResponses,
} from "./shared";
import posthog from "posthog-js";
import { useTranslations, useFormatter } from "next-intl";

export function PaperCardListDetail({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
  hide,
}: PaperCardProps) {
  const tp = useTranslations("paperCard");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const { expandedAbstracts, toggleAbstract } = useResultsStore();
  const { isFocusModeOpen } = useUIStore();
  const isMobile = useIsTablet();

  const searchId = getEffectiveSearchId(pathname, undefined);

  const handleFilteredSearch = (
    filterType: "cites" | "citedBy" | "related",
  ) => {
    const { url } = createCitationSearch(result.id, filterType);

    // Track citation search event
    posthog.capture("citation_search_initiated", {
      filter_type: filterType,
      paper_id: result.id,
      paper_title: result.title,
      paper_year: result.publication_year,
      cited_by_count: result.cited_by_count || 0,
      references_count: result.referenced_works_count || 0,
      related_count: result.related_works?.length || 0,
    });

    router.push(url);
  };

  const handleCitesSearch = () => handleFilteredSearch("cites");
  const handleCitedBySearch = () => handleFilteredSearch("citedBy");
  const handleRelatedSearch = () => handleFilteredSearch("related");

  // Handle paper opened
  const handlePaperOpened = () => {
    openFocusMode(isMobile, resultIndex, result.id);
  };

  const {
    translatedContent,
    showTranslated,
    isTranslating,
    setShowTranslated,
  } = useTranslate(result);

  const isExpanded = expandedAbstracts[result.id];
  const TitleContainer = hide?.focusMode ? "div" : "button";

  return (
    <CardContainer className="overflow-hidden">
      <div className="p-5 @sm/card:p-6">
        {/* COINS metadata span */}
        {!isFocusModeOpen && (
          <span
            className="Z3988"
            title={workToCoins(result)}
            style={{ display: "none" }}
          />
        )}

        {/* Screening Questions */}
        <ScreeningResponses data={result} />

        {/* Title Section */}
        <div className="mb-4">
          {/* Translation toggle - only when translating or we have translation to toggle */}
          {(isTranslating ||
            (translatedContent &&
              !translatedContent.noTranslationNeeded)) && (
            <div className="flex items-center gap-2 mb-2">
              {isTranslating && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  <span>{tc("translating")}</span>
                </div>
              )}

              {translatedContent &&
                !translatedContent.noTranslationNeeded && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTranslated(!showTranslated);
                    }}
                    className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    {showTranslated ? tc("showOriginal") : tc("showTranslation")}
                  </button>
                )}
            </div>
          )}

          {/* Title Button */}
          <TitleContainer
            onClick={hide?.focusMode ? undefined : handlePaperOpened}
            className={cn("text-left w-full", !hide?.focusMode && "group/title")}
          >
            <h3 className="font-semibold text-lg leading-snug text-wrap-anywhere group-hover/title:text-primary transition-colors">
              {showTranslated && translatedContent
                ? translatedContent.translatedTitle
                : result.title}
              <span className="ml-2 text-muted-foreground font-normal">
                ({result.publication_year})
              </span>
            </h3>
          </TitleContainer>
        </div>

        {/* Authors */}
        <AuthorsLine authorships={result.authorships} className="mb-3" />

        {/* Journal/Source */}
        <JournalLine
          source={result.primary_location?.source}
          biblio={result.biblio}
          className="mb-4"
        />

        {/* Abstract */}
        {result.abstract && (
          <div className="mb-4">
            <p className="text-sm text-muted-foreground leading-relaxed text-wrap-anywhere">
              {isExpanded
                ? showTranslated && translatedContent
                  ? translatedContent.translatedAbstract
                  : result.abstract
                : showTranslated && translatedContent
                  ? translatedContent.translatedAbstract.length > 500
                    ? `${translatedContent.translatedAbstract.slice(0, 500)}...`
                    : translatedContent.translatedAbstract
                  : result.abstract.length > 500
                    ? `${result.abstract.slice(0, 500)}...`
                    : result.abstract}
            </p>

            {/* Expanded Metadata */}
            {isExpanded && (
              <div className="mt-5 pt-5 border-t border-border/50 space-y-3">
                {/* Citation Percentile */}
                {result.cited_by_percentile_year && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Award className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">{tp("citationPercentile")}</span>
                    <span className="text-foreground">
                      {result.cited_by_percentile_year.min}-
                      {result.cited_by_percentile_year.max}%
                    </span>
                  </div>
                )}

                {/* Publication Type */}
                {result.type && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">{tp("typeLabel")}</span>
                    <span className="text-foreground capitalize">
                      {result.type.replace(/-/g, " ")}
                    </span>
                  </div>
                )}

                {/* Topic */}
                {result.primary_topic && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Target className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">{tp("topicLabel")}</span>
                    <span className="text-foreground">
                      <TopicLink topic={result.primary_topic} />
                    </span>
                  </div>
                )}

                {/* Subfield */}
                {result.primary_topic?.subfield && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Layers className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">{tp("subfieldLabel")}</span>
                    <span className="text-foreground">
                      <TopicLink topic={result.primary_topic.subfield} />
                    </span>
                  </div>
                )}

                {/* Field */}
                {result.primary_topic?.field && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">{tp("fieldLabel")}</span>
                    <span className="text-foreground">
                      <TopicLink topic={result.primary_topic.field} />
                    </span>
                  </div>
                )}

                {/* Domain */}
                {result.primary_topic?.domain && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Building className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">{tp("domainLabel")}</span>
                    <span className="text-foreground">
                      <TopicLink topic={result.primary_topic.domain} />
                    </span>
                  </div>
                )}

                {/* SDGs */}
                {(result.sustainable_development_goals?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Leaf className="h-3.5 w-3.5 mt-0.5 ink-success" />
                    <div>
                      <span className="font-medium">{tp("sdgsLabel")}</span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {result.sustainable_development_goals!.map(
                          (sdg: {
                            id: string;
                            display_name: string;
                            score: number;
                          }) => (
                            <TooltipHint
                              key={sdg.id}
                              label={tp("sdgWithScoreTooltip", {
                                name: sdg.display_name,
                                scoreLabel: tp("score"),
                                score: sdg.score?.toFixed(2) ?? tc("notAvailable"),
                              })}
                            >
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-success/15 ink-success rounded-full text-xs border border-success/30">
                                {sdg.display_name}
                                {sdg.score && (
                                  <span className="ink-success font-medium">
                                    {sdg.score.toFixed(2)}
                                  </span>
                                )}
                              </span>
                            </TooltipHint>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Additional metrics */}
                <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Quote className="h-3.5 w-3.5" />
                    <span className="font-medium">{tp("referencesLabel")}</span>
                    <span className="text-foreground">
                      {result.referenced_works_count || 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" />
                    <span className="font-medium">{tp("fwciLabel")}</span>
                    <span className="text-foreground">
                      {result.fwci ? result.fwci.toFixed(2) : tc("notAvailable")}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Show More/Less */}
            <button
              onClick={() => toggleAbstract(result.id)}
              className="mt-3 flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  {tc("showLess")}
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  {tc("showMore")}
                </>
              )}
            </button>
          </div>
        )}

        {/* Actions Section */}
        {isMobile ? (
          /* Mobile Layout */
          <div className="space-y-3 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between gap-2">
              {!hide?.rating && (
                <div className="flex items-center gap-2">
                  <RatingSelector paper={result} variant="compact" />
                  <SaveControl paper={result} compact />
                </div>
              )}
              <div className="flex items-center gap-2">
                <CitationControl paper={result} />
                {!hide?.download && (
                  <DownloadMenu
                    variant="icon"
                    onDownloadJSON={() => onDownloadItem(result, "json")}
                    onDownloadCSV={() => onDownloadItem(result, "csv")}
                    onDownloadEssentialJSON={() =>
                      onDownloadEssentialItem(result, "json")
                    }
                    onDownloadEssentialCSV={() =>
                      onDownloadEssentialItem(result, "csv")
                    }
                  />
                )}
              </div>
            </div>

            {/* Full-text links get their own row: beside rating and save they don't fit a phone */}
            {((result.open_access?.is_oa && result.open_access?.oa_url) || result.doi) && (
              <div className="flex items-center gap-2">
                <OpenAccessBadge
                  isOA={result.open_access?.is_oa}
                  oaUrl={result.open_access?.oa_url}
                />
                <DOIBadge doi={result.doi} className="min-w-0 flex-1" />
              </div>
            )}

            {/* Citation cards */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleCitesSearch}
                className="bg-cites/10 hover:bg-cites/15 border border-cites/30 rounded-xl p-3 text-left transition-all group/cite relative"
              >
                <div className="flex items-center gap-1.5 ink-cites mb-1">
                  <Quote className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">{tp("citedBy")}</span>
                </div>
                <div className="text-lg font-bold ink-cites">
                  {format.number(result.cited_by_count ?? 0)}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 text-cites opacity-50 group-hover/cite:opacity-100 transition-opacity" />
              </button>

              <button
                onClick={handleCitedBySearch}
                className="bg-cited-by/10 hover:bg-cited-by/15 border border-cited-by/30 rounded-xl p-3 text-left transition-all group/cite relative"
              >
                <div className="flex items-center gap-1.5 ink-cited-by mb-1">
                  <Quote className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">{tp("cites")}</span>
                </div>
                <div className="text-lg font-bold ink-cited-by">
                  {format.number(result.referenced_works_count ?? 0)}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 text-cited-by opacity-50 group-hover/cite:opacity-100 transition-opacity" />
              </button>

              <button
                onClick={handleRelatedSearch}
                className="bg-related/10 hover:bg-related/15 border border-related/30 rounded-xl p-3 text-left transition-all group/cite relative"
              >
                <div className="flex items-center gap-1.5 ink-related mb-1">
                  <Network className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">{tc("related")}</span>
                </div>
                <div className="text-lg font-bold ink-related">
                  {format.number(result.related_works?.length ?? 0)}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 text-related opacity-50 group-hover/cite:opacity-100 transition-opacity" />
              </button>
            </div>
          </div>
        ) : (
          /* Desktop Layout */
          <div className="flex items-center justify-between gap-4 flex-wrap pt-3 border-t border-border/50">
            <div className="flex items-center gap-3">
              {!hide?.rating && (
                <>
                  <RatingSelector paper={result} variant="compact" />
                  <SaveControl paper={result} />
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <OpenAccessBadge
                isOA={result.open_access?.is_oa}
                oaUrl={result.open_access?.oa_url}
              />
              <DOIBadge doi={result.doi} />
              <CitationControl paper={result} />
              {!hide?.download && (
                <DownloadMenu
                  variant="icon"
                  onDownloadJSON={() => onDownloadItem(result, "json")}
                  onDownloadCSV={() => onDownloadItem(result, "csv")}
                  onDownloadEssentialJSON={() =>
                    onDownloadEssentialItem(result, "json")
                  }
                  onDownloadEssentialCSV={() =>
                    onDownloadEssentialItem(result, "csv")
                  }
                />
              )}
            </div>

            {/* Citation buttons bar */}
            <div className="flex items-center gap-1 w-full bg-muted/50 dark:bg-muted/30 rounded-xl p-1.5">
              <CitationBadge
                count={result.cited_by_count ?? 0}
                label={tp("citedBy")}
                color="orange"
                onClick={handleCitesSearch}
              />
              <CitationBadge
                count={result.referenced_works_count ?? 0}
                label={tp("cites")}
                color="green"
                onClick={handleCitedBySearch}
              />
              <CitationBadge
                count={result.related_works?.length ?? 0}
                label={tc("related")}
                color="blue"
                onClick={handleRelatedSearch}
              />
            </div>
          </div>
        )}
      </div>
    </CardContainer>
  );
}
