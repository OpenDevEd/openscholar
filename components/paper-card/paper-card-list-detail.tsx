"use client";

import React, { useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { workToCoins } from "@/lib/utils";
import { useResultsStore, useUIStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";
import { useIsTablet } from "@/lib/hooks";
import { useSearchOptional } from "@/lib/search";
import { openFocusMode } from "@/lib/search-actions";
import { createCitationSearch } from "@/lib/search";
import { RatingSelector } from "@/components/rating-selector";
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

export function PaperCardListDetail({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
}: PaperCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { expandedAbstracts, toggleAbstract } = useResultsStore();
  const { isFocusModeOpen } = useUIStore();
  const isMobile = useIsTablet();

  const searchId = getEffectiveSearchId(pathname, undefined);

  const search = useSearchOptional();
  const selectedLanguage = search?.params?.lang ?? "";

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
          {/* Translation toggle */}
          {selectedLanguage &&
            selectedLanguage !== "en" &&
            !(translatedContent && translatedContent.isAlreadyInEnglish) && (
              <div className="flex items-center gap-2 mb-2">
                {isTranslating && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    <span>Translating...</span>
                  </div>
                )}

                {translatedContent &&
                  translatedContent.sourceLanguage === selectedLanguage &&
                  !translatedContent.isAlreadyInEnglish && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTranslated(!showTranslated);
                      }}
                      className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                    >
                      {showTranslated ? "Show Original" : "Show English"}
                    </button>
                  )}
              </div>
            )}

          {/* Title Button */}
          <button
            onClick={handlePaperOpened}
            className="text-left w-full group/title"
          >
            <h3 className="font-semibold text-lg leading-snug text-wrap-anywhere group-hover/title:text-primary transition-colors">
              {showTranslated && translatedContent
                ? translatedContent.translatedTitle
                : result.title}
              <span className="ml-2 text-muted-foreground font-normal">
                ({result.publication_year})
              </span>
            </h3>
          </button>
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
                    <span className="font-medium">Citation Percentile:</span>
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
                    <span className="font-medium">Type:</span>
                    <span className="text-foreground capitalize">
                      {result.type.replace(/-/g, " ")}
                    </span>
                  </div>
                )}

                {/* Topic */}
                {result.primary_topic && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Target className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">Topic:</span>
                    <span className="text-foreground">
                      {result.primary_topic.display_name}
                    </span>
                  </div>
                )}

                {/* Subfield */}
                {result.primary_topic?.subfield && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Layers className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">Subfield:</span>
                    <span className="text-foreground">
                      {result.primary_topic.subfield.display_name}
                    </span>
                  </div>
                )}

                {/* Field */}
                {result.primary_topic?.field && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">Field:</span>
                    <span className="text-foreground">
                      {result.primary_topic.field.display_name}
                    </span>
                  </div>
                )}

                {/* Domain */}
                {result.primary_topic?.domain && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Building className="h-3.5 w-3.5 text-primary/70" />
                    <span className="font-medium">Domain:</span>
                    <span className="text-foreground">
                      {result.primary_topic.domain.display_name}
                    </span>
                  </div>
                )}

                {/* SDGs */}
                {result.sustainable_development_goals?.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Leaf className="h-3.5 w-3.5 mt-0.5 text-green-600" />
                    <div>
                      <span className="font-medium">SDGs:</span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {result.sustainable_development_goals.map(
                          (sdg: {
                            id: string;
                            display_name: string;
                            score: number;
                          }) => (
                            <span
                              key={sdg.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300 rounded-full text-xs border border-green-200 dark:border-green-800"
                              title={`${sdg.display_name} (Score: ${sdg.score?.toFixed(2) || "N/A"})`}
                            >
                              {sdg.display_name}
                              {sdg.score && (
                                <span className="text-green-600 dark:text-green-400 font-medium">
                                  {sdg.score.toFixed(2)}
                                </span>
                              )}
                            </span>
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
                    <span className="font-medium">References:</span>
                    <span className="text-foreground">
                      {result.referenced_works_count || 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" />
                    <span className="font-medium">FWCI:</span>
                    <span className="text-foreground">
                      {result.fwci ? result.fwci.toFixed(2) : "N/A"}
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
                  Show Less
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Show More
                </>
              )}
            </button>
          </div>
        )}

        {/* Actions Section */}
        {isMobile ? (
          /* Mobile Layout */
          <div className="space-y-3 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between">
              <RatingSelector paperId={result.id} variant="compact" />
              <div className="flex items-center gap-2">
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
                <OpenAccessBadge
                  isOA={result.open_access?.is_oa}
                  oaUrl={result.open_access?.oa_url}
                />
                <DOIBadge doi={result.doi} compact />
              </div>
            </div>

            {/* Citation cards */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleCitesSearch}
                className="bg-orange-50 dark:bg-orange-950/30 hover:bg-orange-100 dark:hover:bg-orange-950/50 border border-orange-200 dark:border-orange-800 rounded-xl p-3 text-left transition-all group/cite relative"
              >
                <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 mb-1">
                  <Quote className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Cited by</span>
                </div>
                <div className="text-lg font-bold text-orange-700 dark:text-orange-300">
                  {result.cited_by_count || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 text-orange-400 opacity-50 group-hover/cite:opacity-100 transition-opacity" />
              </button>

              <button
                onClick={handleCitedBySearch}
                className="bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-xl p-3 text-left transition-all group/cite relative"
              >
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 mb-1">
                  <Quote className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Cites</span>
                </div>
                <div className="text-lg font-bold text-green-700 dark:text-green-300">
                  {result.referenced_works_count || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 text-green-400 opacity-50 group-hover/cite:opacity-100 transition-opacity" />
              </button>

              <button
                onClick={handleRelatedSearch}
                className="bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-left transition-all group/cite relative"
              >
                <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 mb-1">
                  <Network className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Related</span>
                </div>
                <div className="text-lg font-bold text-blue-700 dark:text-blue-300">
                  {result.related_works?.length || 0}
                </div>
                <ChevronRight className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 text-blue-400 opacity-50 group-hover/cite:opacity-100 transition-opacity" />
              </button>
            </div>
          </div>
        ) : (
          /* Desktop Layout */
          <div className="flex items-center justify-between gap-4 flex-wrap pt-3 border-t border-border/50">
            <div className="flex items-center gap-3">
              <RatingSelector paperId={result.id} variant="compact" />
            </div>

            <div className="flex items-center gap-2">
              <OpenAccessBadge
                isOA={result.open_access?.is_oa}
                oaUrl={result.open_access?.oa_url}
              />
              <DOIBadge doi={result.doi} />
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
            </div>

            {/* Citation buttons bar */}
            <div className="flex items-center gap-1 w-full bg-muted/50 dark:bg-muted/30 rounded-xl p-1.5">
              <CitationBadge
                count={result.cited_by_count || 0}
                label="Cited by"
                color="orange"
                onClick={handleCitesSearch}
              />
              <CitationBadge
                count={result.referenced_works_count || 0}
                label="Cites"
                color="green"
                onClick={handleCitedBySearch}
              />
              <CitationBadge
                count={result.related_works?.length || 0}
                label="Related"
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
