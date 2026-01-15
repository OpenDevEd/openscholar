"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DownloadMenu } from "@/components/download-menu";
import {
  Quote,
  Network,
  FileText,
  ExternalLink,
  Check,
  X,
  Minus,
  Users,
  BookOpen,
  Table,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScreening } from "./hooks";
import { useUIStore } from "@/lib/store";

// ==================== Types ====================

export interface PaperCardProps {
  result: any;
  resultIndex: number;
  onDownloadItem: (item: any, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: any, format: "json" | "csv") => void;
  viewMode?: "list-simple" | "list-detail" | "grid-2" | "grid-3";
}

export interface ScreeningBadgeProps {
  displayState: "checked" | "crossed" | "unchecked" | "loading";
  index: number;
  question: string;
  variant?: "default" | "icon-only";
}

export interface TranslationToggleProps {
  isTranslating: boolean;
  translatedContent: any;
  showTranslated: boolean;
  selectedLanguage: string;
  setShowTranslated: (show: boolean) => void;
  variant?: "full" | "compact";
}

// ==================== Utility Functions ====================

export function truncateAuthors(
  authorships: { author: { display_name: string } }[],
  maxLength: number = 100
): string {
  if (!authorships || authorships.length === 0) return "";
  
  const names = authorships.map((a) => a.author.display_name);
  let result = names[0];
  
  for (let i = 1; i < names.length; i++) {
    const next = `${result}, ${names[i]}`;
    if (next.length > maxLength) {
      return `${result} et al.`;
    }
    result = next;
  }
  
  return result;
}

export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function getFirstAuthor(
  authorships: { author: { display_name: string } }[]
): string {
  if (!authorships || authorships.length === 0) return "";
  const first = authorships[0].author.display_name;
  if (authorships.length > 1) {
    return `${first} et al.`;
  }
  return first;
}

export function finalState(
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

// ==================== Shared Components ====================

export function TranslationToggle({
  isTranslating,
  translatedContent,
  showTranslated,
  selectedLanguage,
  setShowTranslated,
  variant = "full",
}: TranslationToggleProps) {
  if (!selectedLanguage || selectedLanguage === "en") return null;
  if (translatedContent && translatedContent.isAlreadyInEnglish) return null;

  if (variant === "compact") {
    // Icon-only version for compact layouts
    if (!translatedContent || translatedContent.sourceLanguage !== selectedLanguage) {
      if (isTranslating) {
        return (
          <div className="flex items-center justify-center p-1.5 rounded-md bg-blue-50 dark:bg-blue-950/30" title="Translating...">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        );
      }
      return null;
    }

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowTranslated(!showTranslated);
        }}
        className={cn(
          "flex items-center justify-center p-1.5 rounded-md text-xs font-medium transition-colors",
          showTranslated
            ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        )}
        title={showTranslated ? "Show Original" : "Show English"}
      >
        {showTranslated ? "EN" : "原"}
      </button>
    );
  }

  // Full version for detailed layouts
  return (
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
  );
}

export function ScreeningResponses({
  data,
  expandShortcut,
  variant,
}: {
  data: { id: string; title: string; abstract: string };
  expandShortcut?: string;
  variant?: "default" | "mobile" | "icons-only";
}) {
  const {
    screeningQuestions,
    myExistingResponses,
    myLoadingResponses,
    myMissingResponses,
  } = useScreening(data);

  const showExpandedView = useUIStore((state) => state.expandedScreeningDetails[data.id] || false);
  const setScreeningDetailExpanded = useUIStore((state) => state.setScreeningDetailExpanded);

  useEffect(() => {
    if (!expandShortcut) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      if (
        event.key === expandShortcut &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        setScreeningDetailExpanded(data.id, !showExpandedView);
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [expandShortcut, data.id, showExpandedView, setScreeningDetailExpanded]);

  if (screeningQuestions.length === 0) return null;

  // Icons-only variant for compact layouts
  if (variant === "icons-only") {
    return (
      <div className="flex items-center gap-1 flex-wrap">
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
    );
  }

  // Full variant with expandable table
  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2 items-center">
        {screeningQuestions.map((question, index) => {
          const isQuestionAnswered = myExistingResponses[question.question];
          const isQuestionLoading = myLoadingResponses[question.question];
          const isQuestionMissing = myMissingResponses.includes(question.question);
          const displayState = finalState(isQuestionAnswered, isQuestionLoading, isQuestionMissing);

          return (
            <button
              key={index}
              disabled={displayState === "loading"}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors",
                displayState === "checked"
                  ? "bg-green-50 border-green-200 text-green-800 hover:bg-green-100 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400"
                  : displayState === "crossed"
                  ? "bg-red-50 border-red-200 text-red-800 hover:bg-red-100 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400"
                  : displayState === "loading"
                  ? "bg-blue-50 border-blue-200 text-blue-800 cursor-wait dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400"
                  : "bg-muted/50 border-border text-muted-foreground hover:bg-muted/80"
              )}
              title={`Question ${index + 1}: ${question.question}`}
            >
              {displayState === "checked" && <Check className="h-3 w-3" />}
              {displayState === "crossed" && <X className="h-3 w-3" />}
              {displayState === "unchecked" && <Minus className="h-3 w-3" />}
              {displayState === "loading" && (
                <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              )}
              <span className="font-mono">{index + 1}</span>
            </button>
          );
        })}

        {/* Expand Button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setScreeningDetailExpanded(data.id, !showExpandedView);
          }}
          className="flex items-center gap-1 px-2 py-1 rounded border bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100 text-xs transition-colors dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400"
          title={`Show detailed screening responses${
            expandShortcut ? ` (${expandShortcut.toUpperCase()})` : ""
          }`}
        >
          <Table className="h-3 w-3" />
          {showExpandedView ? "Hide" : "Details"}
          {expandShortcut && (
            <span className="text-xs bg-black/10 dark:bg-white/10 px-1 rounded hidden md:inline">
              {expandShortcut.toUpperCase()}
            </span>
          )}
        </button>
      </div>

      {/* Expanded Table View */}
      {showExpandedView && (
        <div className="mt-3 p-4 bg-muted/30 rounded-lg border">
          <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <Table className="h-4 w-4" />
            Screening Responses
          </h4>

          <div className={variant === "mobile" ? "overflow-hidden" : "overflow-x-auto"}>
            <table className={variant === "mobile" ? "w-full text-xs" : "w-full text-xs min-w-full"}>
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground w-8">
                    #
                  </th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                    Question
                  </th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground w-16">
                    Response
                  </th>
                </tr>
              </thead>
              <tbody>
                {screeningQuestions.map((question, index) => {
                  const isQuestionAnswered = myExistingResponses[question.question];
                  const isQuestionLoading = myLoadingResponses[question.question];
                  const isQuestionMissing = myMissingResponses.includes(question.question);
                  const displayState = finalState(isQuestionAnswered, isQuestionLoading, isQuestionMissing);
                  const statusText =
                    isQuestionAnswered === true
                      ? "Yes"
                      : isQuestionAnswered === false
                      ? "No"
                      : isQuestionLoading
                      ? "Loading..."
                      : "?";

                  return (
                    <tr
                      key={index}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="py-2 px-2 font-mono text-muted-foreground w-8 align-top">
                        {index + 1}
                      </td>
                      <td className="py-2 px-2 text-foreground">
                        <div className={variant === "mobile" ? "break-words whitespace-normal" : "truncate max-w-xs"} title={question.question}>
                          {question.question}
                        </div>
                      </td>
                      <td className="py-2 px-2 w-16 align-top">
                        <div
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded text-xs",
                            displayState === "checked"
                              ? "bg-green-100 text-green-800 border border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800"
                              : displayState === "crossed"
                              ? "bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800"
                              : displayState === "loading"
                              ? "bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800"
                              : "bg-gray-100 text-gray-700 border border-gray-200 dark:bg-muted/50 dark:text-muted-foreground dark:border-border"
                          )}
                        >
                          {displayState === "checked" && <Check className="h-3 w-3" />}
                          {displayState === "crossed" && <X className="h-3 w-3" />}
                          {displayState === "unchecked" && <Minus className="h-3 w-3" />}
                          {displayState === "loading" && (
                            <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                          )}
                          {statusText}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function ScreeningBadge({
  displayState,
  index,
  question,
  variant = "default",
}: ScreeningBadgeProps) {
  const baseClasses = cn(
    "flex items-center gap-1 rounded border text-xs transition-colors",
    variant === "icon-only" ? "p-1" : "px-2 py-1"
  );

  const stateClasses = {
    checked: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400",
    crossed: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400",
    loading: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400 cursor-wait",
    unchecked: "bg-muted/50 border-border text-muted-foreground",
  };

  return (
    <div
      className={cn(baseClasses, stateClasses[displayState])}
      title={`Question ${index + 1}: ${question}`}
    >
      {displayState === "checked" && <Check className="h-3 w-3" />}
      {displayState === "crossed" && <X className="h-3 w-3" />}
      {displayState === "unchecked" && <Minus className="h-3 w-3" />}
      {displayState === "loading" && (
        <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
      )}
      {variant !== "icon-only" && <span className="font-mono">{index + 1}</span>}
    </div>
  );
}

export function CitationBadge({
  count,
  label,
  color,
  onClick,
  compact = false,
}: {
  count: number;
  label: string;
  color: "orange" | "green" | "blue";
  onClick?: () => void;
  compact?: boolean;
}) {
  const colorClasses = {
    orange: "text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/50",
    green: "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/50",
    blue: "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50",
  };

  const Icon = color === "blue" ? Network : Quote;

  if (compact) {
    return (
      <button
        onClick={onClick}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
          colorClasses[color]
        )}
        title={label}
      >
        <Icon className="h-3 w-3" />
        <span>{count}</span>
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("flex items-center gap-2 flex-shrink-0", colorClasses[color])}
      title={label}
    >
      <Icon className="h-4 w-4" />
      <span className="text-sm">{label}: {count}</span>
    </Button>
  );
}

export function OpenAccessBadge({
  isOA,
  oaUrl,
  compact = false,
}: {
  isOA: boolean;
  oaUrl?: string;
  compact?: boolean;
}) {
  if (!isOA || !oaUrl) return null;

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => window.open(oaUrl, "_blank")}
        onKeyDown={(e) => e.key === "Enter" && window.open(oaUrl, "_blank")}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            window.open(oaUrl, "_blank");
          }
        }}
        className="flex items-center justify-center p-1.5 rounded-md text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/50 transition-colors cursor-pointer"
        title="Open Access PDF"
      >
        <FileText className="h-4 w-4" />
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.open(oaUrl, "_blank")}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.open(oaUrl, "_blank");
        }
      }}
      className="flex items-center gap-2 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50 cursor-pointer flex-shrink-0"
      title="Open Access PDF"
    >
      <FileText className="h-4 w-4" />
      <span>PDF</span>
    </Button>
  );
}

export function DOIBadge({
  doi,
  compact = false,
}: {
  doi: string;
  compact?: boolean;
}) {
  if (!doi) return null;

  const doiUrl = doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
  const shortDoi = doi.replace("https://doi.org/", "");

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => window.open(doiUrl, "_blank")}
        onKeyDown={(e) => e.key === "Enter" && window.open(doiUrl, "_blank")}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            window.open(doiUrl, "_blank");
          }
        }}
        className="flex items-center justify-center p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors cursor-pointer"
        title={`DOI: ${shortDoi}`}
      >
        <ExternalLink className="h-4 w-4" />
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.open(doiUrl, "_blank")}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.open(doiUrl, "_blank");
        }
      }}
      className="flex items-center gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/50 cursor-pointer flex-shrink-0"
      title="Open DOI"
    >
      <ExternalLink className="h-3 w-3" />
      <span className="text-xs font-mono">{shortDoi}</span>
    </Button>
  );
}

export function DownloadMenuCompact({
  onDownloadJSON,
  onDownloadCSV,
  onDownloadEssentialJSON,
  onDownloadEssentialCSV,
}: {
  onDownloadJSON: () => void;
  onDownloadCSV: () => void;
  onDownloadEssentialJSON: () => void;
  onDownloadEssentialCSV: () => void;
}) {
  return (
    <DownloadMenu
      variant="icon"
      onDownloadJSON={onDownloadJSON}
      onDownloadCSV={onDownloadCSV}
      onDownloadEssentialJSON={onDownloadEssentialJSON}
      onDownloadEssentialCSV={onDownloadEssentialCSV}
    />
  );
}


export function AuthorsLine({
  authorships,
  maxLength = 200,
  className,
}: {
  authorships: { author: { display_name: string } }[];
  maxLength?: number;
  className?: string;
}) {
  if (!authorships || authorships.length === 0) return null;

  return (
    <div className={cn("flex gap-2 text-sm text-muted-foreground", className)}>
      <Users className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span className="line-clamp-1">{truncateAuthors(authorships, maxLength)}</span>
    </div>
  );
}

export function JournalLine({
  source,
  biblio,
  className,
}: {
  source?: { display_name: string };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
  className?: string;
}) {
  if (!source?.display_name) return null;

  return (
    <div className={cn("flex gap-2 text-sm text-muted-foreground", className)}>
      <BookOpen className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span className="italic line-clamp-1">
        {source.display_name}
        {biblio?.volume && `, Vol. ${biblio.volume}`}
        {biblio?.issue && ` (${biblio.issue})`}
        {biblio?.first_page && (
          <>
            {`, pp. ${biblio.first_page}`}
            {biblio?.last_page && `-${biblio.last_page}`}
          </>
        )}
      </span>
    </div>
  );
}

// Card container styles matching the design language
export const cardContainerClasses = {
  base: cn(
    "relative group rounded-2xl border transition-all duration-200",
    "bg-background/80 dark:bg-background/60",
    "border-border/60 dark:border-border/40",
    "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
    "backdrop-blur-xl backdrop-saturate-150"
  ),
  hover: cn(
    "hover:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent/30",
    "hover:border-primary/20 dark:hover:border-primary/30",
    "hover:shadow-xl hover:shadow-black/[0.05] dark:hover:shadow-black/[0.15]",
    "hover:-translate-y-0.5"
  ),
  focus: cn(
    "focus-within:ring-2 focus-within:ring-primary/10",
    "focus-within:border-primary/50"
  ),
};

export function CardContainer({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        cardContainerClasses.base,
        cardContainerClasses.hover,
        cardContainerClasses.focus,
        "@container/card",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
