"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
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
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { useScreening } from "./hooks";
import type { TranslationContent } from "./hooks";
import { useUIStore } from "@/lib/store";
import { useTranslations, useFormatter } from "next-intl";
import type { PaperResult } from "@/lib/types";

// ==================== Types ====================

export interface PaperCardProps {
  result: PaperResult;
  resultIndex: number;
  onDownloadItem: (item: PaperResult, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: PaperResult, format: "json" | "csv") => void;
  viewMode?: "list-simple" | "list-detail" | "grid-2" | "grid-3";
  /** Controls to leave out where they cannot be used, such as an import preview. */
  hide?: PaperCardHide;
}

export interface PaperCardHide {
  /** Ratings belong to a saved search, not to a preview. */
  rating?: boolean;
  download?: boolean;
  focusMode?: boolean;
}

export interface ScreeningBadgeProps {
  displayState: "checked" | "crossed" | "unchecked" | "loading";
  index: number;
  question: string;
  variant?: "default" | "icon-only";
}

export interface TranslationToggleProps {
  isTranslating: boolean;
  translatedContent: TranslationContent | null;
  showTranslated: boolean;
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
  // Priority: answered > loading > missing
  // Questions with answers should never show spinner
  if (isQuestionAnswered != null)
    return isQuestionAnswered === true
      ? "checked"
      : isQuestionAnswered === false
      ? "crossed"
      : "unchecked";
  if (isQuestionLoading) return "loading";
  if (isQuestionMissing) return "unchecked";
  return "unchecked";
}

// ==================== Shared Components ====================

export function TranslationToggle({
  isTranslating,
  translatedContent,
  showTranslated,
  setShowTranslated,
  variant = "full",
}: TranslationToggleProps) {
  const tc = useTranslations("common");
  if (translatedContent && translatedContent.noTranslationNeeded) return null;

  const hasToggleContent =
    translatedContent &&
    !translatedContent.noTranslationNeeded;
  if (!isTranslating && !hasToggleContent) return null;

  if (variant === "compact") {
    // Icon-only version for compact layouts
    if (!translatedContent) {
      if (isTranslating) {
        return (
          <TooltipHint label={tc("translating")}>
            <div role="img" aria-label={tc("translating")} className="flex items-center justify-center p-1.5 rounded-md bg-info/10">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-info border-t-transparent" />
            </div>
          </TooltipHint>
        );
      }
      return null;
    }

    return (
      <TooltipHint label={showTranslated ? tc("showOriginal") : tc("showTranslation")}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowTranslated(!showTranslated);
          }}
          className={cn(
            "flex items-center justify-center p-1.5 rounded-md text-xs font-medium transition-colors",
            showTranslated
              ? "bg-info/15 ink-info"
              : "bg-muted text-muted-foreground hover:bg-accent"
          )}
        >
          {showTranslated ? tc("originalShort") : tc("translationShort")}
        </button>
      </TooltipHint>
    );
  }

  // Full version for detailed layouts
  return (
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
  );
}

export function ScreeningResponses({
  data,
  expandShortcut,
  variant,
}: {
  data: { id: string; title?: string; abstract?: string };
  expandShortcut?: string;
  variant?: "default" | "mobile" | "icons-only";
}) {
  const tp = useTranslations("paperCard");
  const tc = useTranslations("common");
  const {
    screeningQuestions,
    myExistingResponses,
    myLoadingQuestions,
    myMissingResponses,
    isScreeningPanelOpen,
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

  if (!isScreeningPanelOpen || screeningQuestions.length === 0) return null;

  // Icons-only variant for compact layouts
  if (variant === "icons-only") {
    return (
      <div className="flex items-center gap-1 flex-wrap">
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
    );
  }

  // Full variant with expandable table
  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2 items-center">
        {screeningQuestions.map((question, index) => {
          const isQuestionAnswered = myExistingResponses[question.question];
          const isQuestionLoading = myLoadingQuestions.has(question.question);
          const isQuestionMissing = myMissingResponses.includes(question.question);
          const displayState = finalState(isQuestionAnswered, isQuestionLoading, isQuestionMissing);

          return (
            <TooltipHint
              key={question.question}
              label={tp("questionN", { n: index + 1, question: question.question })}
            >
              <span className="inline-flex">
                <button
                  disabled={displayState === "loading"}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors",
                    displayState === "checked"
                      ? "bg-success/10 border-success/30 ink-success hover:bg-success/15"
                      : displayState === "crossed"
                      ? "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/15"
                      : displayState === "loading"
                      ? "bg-info/10 border-info/30 ink-info cursor-wait"
                      : "bg-inset border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {displayState === "checked" && <Check className="h-3 w-3" />}
                  {displayState === "crossed" && <X className="h-3 w-3" />}
                  {displayState === "unchecked" && <Minus className="h-3 w-3" />}
                  {displayState === "loading" && (
                    <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  )}
                  <span className="font-mono">{index + 1}</span>
                </button>
              </span>
            </TooltipHint>
          );
        })}

        {/* Expand Button */}
        <TooltipHint
          label={tp("showDetailedScreeningResponses") +
            (expandShortcut ? tp("shortcutInTooltip", { shortcut: expandShortcut.toUpperCase() }) : "")}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setScreeningDetailExpanded(data.id, !showExpandedView);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded border bg-info/10 border-info/30 ink-info hover:bg-info/15 text-xs transition-colors"
          >
            <Table className="h-3 w-3" />
            {showExpandedView ? tc("hide") : tc("details")}
            {expandShortcut && (
              <span className="text-xs bg-black/10 dark:bg-white/10 px-1 rounded hidden md:inline">
                {expandShortcut.toUpperCase()}
              </span>
            )}
          </button>
        </TooltipHint>
      </div>

      {/* Expanded Table View */}
      {showExpandedView && (
        <div className="mt-3 p-4 bg-inset rounded-lg border">
          <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <Table className="h-4 w-4" />
            {tp("screeningResponses")}
          </h4>

          <div className={variant === "mobile" ? "overflow-hidden" : "overflow-x-auto"}>
            <table className={variant === "mobile" ? "w-full text-xs" : "w-full text-xs min-w-full"}>
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground w-8">
                    #
                  </th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                    {tc("question")}
                  </th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground w-16">
                    {tc("response")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {screeningQuestions.map((question, index) => {
                  const isQuestionAnswered = myExistingResponses[question.question];
                  const isQuestionLoading = myLoadingQuestions.has(question.question);
                  const isQuestionMissing = myMissingResponses.includes(question.question);
                  const displayState = finalState(isQuestionAnswered, isQuestionLoading, isQuestionMissing);
                  const statusText =
                    isQuestionAnswered === true
                      ? tc("yes")
                      : isQuestionAnswered === false
                      ? tc("no")
                      : isQuestionLoading
                      ? tc("loading")
                      : tc("unknown");

                  return (
                    <tr
                      key={question.question}
                      className="border-b border-border-subtle hover:bg-muted transition-colors"
                    >
                      <td className="py-2 px-2 font-mono text-muted-foreground w-8 align-top">
                        {index + 1}
                      </td>
                      <td className="py-2 px-2 text-foreground">
                        <div className="break-words whitespace-normal">
                          {question.question}
                        </div>
                      </td>
                      <td className="py-2 px-2 w-16 align-top">
                        <div
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded text-xs",
                            displayState === "checked"
                              ? "bg-success/15 ink-success border border-success/30"
                              : displayState === "crossed"
                              ? "bg-destructive/15 text-destructive border border-destructive/30"
                              : displayState === "loading"
                              ? "bg-info/15 ink-info border border-info/30"
                              : "bg-muted text-muted-foreground border border-border"
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
  const tp = useTranslations("paperCard");
  const baseClasses = cn(
    "flex items-center gap-1 rounded border text-xs transition-colors",
    variant === "icon-only" ? "p-1" : "px-2 py-1"
  );

  const stateClasses = {
    checked: "bg-success/10 border-success/30 ink-success",
    crossed: "bg-destructive/10 border-destructive/30 text-destructive",
    loading: "bg-info/10 border-info/30 ink-info cursor-wait",
    unchecked: "bg-inset border-border text-muted-foreground",
  };

  const label = tp("questionN", { n: index + 1, question });

  return (
    <TooltipHint label={label}>
      <div
        role="img"
        aria-label={label}
        className={cn(baseClasses, stateClasses[displayState])}
      >
        {displayState === "checked" && <Check className="h-3 w-3" />}
        {displayState === "crossed" && <X className="h-3 w-3" />}
        {displayState === "unchecked" && <Minus className="h-3 w-3" />}
        {displayState === "loading" && (
          <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
        )}
        {variant !== "icon-only" && <span className="font-mono">{index + 1}</span>}
      </div>
    </TooltipHint>
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
  const format = useFormatter();
  const colorClasses = {
    orange: "ink-cites hover:bg-cites/10",
    green: "ink-cited-by hover:bg-cited-by/10",
    blue: "ink-related hover:bg-related/10",
  };

  const Icon = color === "blue" ? Network : Quote;

  if (compact) {
    return (
      <TooltipHint label={label}>
        <button
          onClick={onClick}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
            colorClasses[color]
          )}
        >
          <Icon className="h-3 w-3" />
          <span>{format.number(count)}</span>
        </button>
      </TooltipHint>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("flex items-center gap-2 flex-shrink-0", colorClasses[color])}
    >
      <Icon className="h-4 w-4" />
      <span className="text-sm">{label}: {format.number(count)}</span>
    </Button>
  );
}

export function OpenAccessBadge({
  isOA,
  oaUrl,
  compact = false,
}: {
  isOA?: boolean;
  oaUrl?: string;
  compact?: boolean;
}) {
  const tc = useTranslations("common");
  if (!isOA || !oaUrl) return null;

  if (compact) {
    return (
      <TooltipHint label={tc("openAccessPdf")}>
        <div
          role="button"
          tabIndex={0}
          aria-label={tc("openAccessPdf")}
          onClick={() => window.open(oaUrl, "_blank")}
          onKeyDown={(e) => e.key === "Enter" && window.open(oaUrl, "_blank")}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              window.open(oaUrl, "_blank");
            }
          }}
          className="flex items-center justify-center p-1.5 rounded-md ink-success hover:bg-success/10 transition-colors cursor-pointer"
        >
          <FileText className="h-4 w-4" />
        </div>
      </TooltipHint>
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
      className="flex items-center gap-2 ink-success border-success/30 hover:bg-success/10 hover:border-success/40 cursor-pointer flex-shrink-0"
    >
      <FileText className="h-4 w-4" />
      <span>{tc("pdf")}</span>
    </Button>
  );
}

export function DOIBadge({
  doi,
  compact = false,
  className,
}: {
  doi?: string;
  compact?: boolean;
  className?: string;
}) {
  const tAcc = useTranslations("accessibility");
  if (!doi) return null;

  const doiUrl = doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
  const shortDoi = doi.replace("https://doi.org/", "");

  if (compact) {
    return (
      <TooltipHint label={tAcc("doiTooltip", { doi: shortDoi })}>
        <div
          role="button"
          tabIndex={0}
          aria-label={tAcc("doiTooltip", { doi: shortDoi })}
          onClick={() => window.open(doiUrl, "_blank")}
          onKeyDown={(e) => e.key === "Enter" && window.open(doiUrl, "_blank")}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              window.open(doiUrl, "_blank");
            }
          }}
          className="flex items-center justify-center p-1.5 rounded-md ink-info hover:bg-info/10 transition-colors cursor-pointer"
        >
          <ExternalLink className="h-4 w-4" />
        </div>
      </TooltipHint>
    );
  }

  return (
    <TooltipHint label={shortDoi} onlyWhenClipped>
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
        className={cn(
          "flex items-center gap-1 ink-info border-info/30 hover:bg-info/10 hover:border-info/40 cursor-pointer flex-shrink-0",
          className,
        )}
      >
        <ExternalLink className="h-3 w-3" />
        <span className="truncate text-xs font-mono">{shortDoi}</span>
      </Button>
    </TooltipHint>
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
  authorships?: { author: { display_name: string } }[];
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
  source?: { display_name?: string };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
  className?: string;
}) {
  const tp = useTranslations("paperCard");
  if (!source?.display_name) return null;

  return (
    <div className={cn("flex gap-2 text-sm text-muted-foreground", className)}>
      <BookOpen className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span className="italic line-clamp-1">
        {source.display_name}
        {biblio?.volume && `, ${tp("vol")} ${biblio.volume}`}
        {biblio?.issue && ` (${biblio.issue})`}
        {biblio?.first_page && (
          <>
            {`, ${tp("pp")} ${biblio.first_page}`}
            {biblio?.last_page && `-${biblio.last_page}`}
          </>
        )}
      </span>
    </div>
  );
}

// Card container styles matching the design language
const cardContainerClasses = {
  base: cn(
    "relative group rounded-2xl border transition-all duration-200",
    "bg-card",
    "border-border-subtle",
    "shadow-surface"
  ),
  hover: cn(
    "hover:bg-card-hover",
    "hover:border-primary/20 dark:hover:border-primary/30",
    "hover:shadow-surface-hover",
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
  const containerClassName = cn(
    cardContainerClasses.base,
    cardContainerClasses.hover,
    cardContainerClasses.focus,
    "@container/card",
    className
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(containerClassName, "w-full text-left appearance-none")}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {children}
      </button>
    );
  }

  return <div className={containerClassName}>{children}</div>;
}
