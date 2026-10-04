import { TopicLink } from "@/components/topics/topic-link";
import React from "react";
import { BookOpen, Award, ExternalLink, FileText } from "@/components/icons";
import { cn } from "@/lib/utils";
import { workToCoins } from "@/lib/utils";
import { ScreeningResponses } from "@/components/paper-card";
import { AuthorNames } from "@/components/paper-card/shared";
import { TooltipHint } from "@/components/ui/tooltip";
import type { PaperResult } from "@/lib/types";

export interface PaperContentProps {
  paper: PaperResult;
  isPreview?: boolean;
  contentClasses: string;
  fontSizeClass: string;
  lineHeightClass: string;
  settings: { compactMode: boolean; showMetadata: boolean };
  showTranslated: boolean;
  translatedContent: {
    translatedTitle: string;
    translatedAbstract: string;
    noTranslationNeeded?: boolean;
  } | null;
  tFocus: (key: string) => string;
  tLabels: (key: string) => string;
  tCommon: (key: string) => string;
  tp: (key: string, opts?: Record<string, unknown>) => string;
  tAccessibility: (key: string) => string;
  isOpen: boolean;
  /** The authors the search is filtered by, as OpenAlex ids. */
  selectedAuthors?: readonly string[];
  /** Filters the search by an author, or stops filtering by them. Left out where there is no search. */
  onToggleAuthor?: (author: { value: string; name: string }) => void;
}

export function PaperContent({
  paper,
  isPreview = false,
  contentClasses,
  fontSizeClass,
  lineHeightClass,
  settings,
  showTranslated,
  translatedContent,
  tFocus,
  tLabels,
  tCommon,
  tp,
  tAccessibility,
  isOpen,
  selectedAuthors,
  onToggleAuthor,
}: PaperContentProps) {
  return (
    <div className={contentClasses}>
      {/* COINS metadata span - only render for the currently focused paper (not preview) */}
      {!isPreview && isOpen && (
        <span
          className="Z3988"
          title={workToCoins(paper)}
          style={{ display: "none" }}
        ></span>
      )}

      <ScreeningResponses data={paper} expandShortcut="e" variant="mobile" />

      {/* Title & Year - Compact */}
      <div className={cn(settings.compactMode ? "mb-1" : "mb-2")}>
        <h1
          className={cn("font-bold leading-tight mb-1", fontSizeClass)}
        >
          {isPreview
            ? `${tFocus("machineLearningPreview")} (2024)`
            : showTranslated && translatedContent
            ? `${translatedContent.translatedTitle} (${paper.publication_year})`
            : `${paper.title} (${paper.publication_year})`}
        </h1>
        <div className="text-sm text-muted-foreground">
          {isPreview ? (
            <span className="block truncate">
              {tFocus("authorsPreview")}
            </span>
          ) : (
            paper.authorships && (
              <AuthorNames
                authorships={paper.authorships}
                selected={selectedAuthors}
                onToggleAuthor={onToggleAuthor}
              />
            )
          )}
        </div>
        {/* Journal/Source with volume/issue/pages */}
        {!isPreview && paper.primary_location?.source?.display_name && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <BookOpen className="h-3 w-3 flex-shrink-0" />
            <span className="italic truncate">
              {paper.primary_location.source.display_name}
              {(paper.biblio?.volume || paper.biblio?.issue || paper.biblio?.first_page) && (
                <>
                  {paper.biblio?.volume && `, ${tp("vol")} ${paper.biblio.volume}`}
                  {paper.biblio?.issue && ` (${paper.biblio.issue})`}
                  {paper.biblio?.first_page && (
                    <>
                      {`, ${tp("pp")} ${paper.biblio.first_page}`}
                      {paper.biblio?.last_page && `-${paper.biblio.last_page}`}
                    </>
                  )}
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Inline Metadata - Single Line Approach */}
      {settings.showMetadata && (
        <div
          className={cn(
            settings.compactMode ? "mb-1 text-xs" : "mb-2 text-xs"
          )}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {!isPreview && paper.type && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("type")}:</span>
                <span className="font-medium capitalize">
                  {paper.type.replace(/-/g, " ")}
                </span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground">{tLabels("refs")}:</span>
              <span className="font-medium">
                {isPreview ? "127" : paper.referenced_works_count || 0}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground">{tLabels("cited")}:</span>
              <span className="font-medium">
                {isPreview ? "89" : paper.cited_by_count || 0}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground">{tLabels("fwci")}:</span>
              <span className="font-medium">
                {isPreview
                  ? "2.34"
                  : paper.fwci
                  ? paper.fwci.toFixed(2)
                  : tCommon("notAvailable")}
              </span>
            </span>
            {(isPreview || paper.cited_by_percentile_year) && (
              <span className="flex items-center gap-1">
                <Award className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">
                  {isPreview
                    ? "85-95%"
                    : `${paper.cited_by_percentile_year!.min}-${paper.cited_by_percentile_year!.max}%`}
                </span>
              </span>
            )}
            {(isPreview || paper.primary_topic) && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("topic")}:</span>
                <span className="font-medium">
                  {isPreview
                    ? tFocus("machineLearningPreview")
                    : <TopicLink topic={paper.primary_topic!} />}
                </span>
              </span>
            )}
            {!isPreview && paper.primary_topic?.field && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("field")}:</span>
                <span className="font-medium">
                  <TopicLink topic={paper.primary_topic.field} />
                </span>
              </span>
            )}
            {!isPreview && paper.primary_topic?.subfield && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("subfield")}:</span>
                <span className="font-medium">
                  <TopicLink topic={paper.primary_topic.subfield} />
                </span>
              </span>
            )}
            {!isPreview && paper.primary_topic?.domain && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("domain")}:</span>
                <span className="font-medium">
                  <TopicLink topic={paper.primary_topic.domain} />
                </span>
              </span>
            )}
            {!isPreview && paper.open_access && paper.open_access.is_oa && (
              <span className="flex items-center gap-1">
                <>
                  <FileText className="h-3 w-3 ink-success" />
                  <span className="ink-success font-medium">{tFocus("pdf")}</span>
                  {paper.open_access.oa_url && (
                    <>
                      <a
                        href={paper.open_access.oa_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ink-info hover:underline"
                      ></a>
                      <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                        A
                      </span>
                    </>
                  )}
                </>
              </span>
            )}

            {/* DOI Button */}
            {!isPreview && paper.doi && (
              <span className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const doiUrl = paper.doi!.startsWith("http")
                      ? paper.doi!
                      : `https://doi.org/${paper.doi!}`;
                    window.open(doiUrl, "_blank");
                  }}
                  className="flex items-center gap-1 text-xs ink-info hover:underline cursor-pointer"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className="font-mono">
                    {paper.doi!.replace("https://doi.org/", "")}
                  </span>
                </button>
                <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                  I
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Topic & SDGs - Compact Row */}
      {settings.showMetadata && !isPreview && (
        <div
          className={cn(
            settings.compactMode
              ? "mb-1 text-xs space-y-1"
              : "mb-2 text-xs space-y-1"
          )}
        >
          {paper.sustainable_development_goals &&
            paper.sustainable_development_goals.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">{tLabels("sdgs")}:</span>
                {paper.sustainable_development_goals
                  .slice(0, 2)
                  .map(
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
                          score: sdg.score?.toFixed(2) ?? tCommon("notAvailable"),
                        })}
                      >
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-success/15 ink-success rounded-full text-xs">
                          {sdg.display_name}
                          {sdg.score && (
                            <span className="ink-success font-medium">
                              {sdg.score.toFixed(2)}
                            </span>
                          )}
                        </span>
                      </TooltipHint>
                    )
                  )}
                {paper.sustainable_development_goals.length > 2 && (
                  <span className="text-muted-foreground">
                    {tp("moreSdgs", {
                      count: paper.sustainable_development_goals.length - 2,
                    })}
                  </span>
                )}
              </div>
            )}
        </div>
      )}

      {/* Abstract - Takes Remaining Space */}
      {(paper.abstract || isPreview) && (
        <div className="border-t pt-2">
          <div className="text-sm font-medium text-muted-foreground mb-1">
            {tCommon("abstract")}
          </div>
          <div className={cn("pr-2", fontSizeClass, lineHeightClass)}>
            {isPreview
              ? tFocus("abstractPreview")
              : showTranslated && translatedContent
              ? translatedContent.translatedAbstract
              : paper.abstract}
          </div>
        </div>
      )}
    </div>
  );
}
