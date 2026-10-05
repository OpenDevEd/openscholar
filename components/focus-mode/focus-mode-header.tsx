import { CitationControl } from "@/components/citation-control";
import React from "react";
import { Button } from "@/components/ui/button";
import {
  SheetClose,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ChevronLeft,
  ChevronRight,
  Star,
  Globe,
  ExternalLink,
  Settings,
  Loader2,
  X,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { DownloadMenu } from "@/components/download-menu";
import { RatingSelector } from "@/components/rating-selector";
import { SaveControl } from "@/components/library/save-control";
import { useEffectiveRating } from "@/components/results-contexts";
import type { PaperResult } from "@/lib/types";

export interface FocusModeHeaderProps {
  currentPaper: PaperResult;
  currentIndex: number;
  totalPapers: number;
  showSettings: boolean;
  showTranslated: boolean;
  translatedContent: { translatedTitle: string; translatedAbstract: string; noTranslationNeeded?: boolean } | null;
  isTranslating: boolean;
  isMobile: boolean;
  onRatingChange: (paperId: string, rating: string) => void;
  onToggleTranslation: () => void;
  onToggleSettings: () => void;
  onGoToPrevious: () => void;
  onGoToNext: () => void;
  onDownloadItem: (item: PaperResult, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: PaperResult, format: "json" | "csv") => void;
  tFocus: (key: string) => string;
  tAccessibility: (key: string) => string;
}

export function FocusModeHeader({
  currentPaper,
  currentIndex,
  totalPapers,
  showSettings,
  showTranslated,
  translatedContent,
  isTranslating,
  isMobile,
  onRatingChange,
  onToggleTranslation,
  onToggleSettings,
  onGoToPrevious,
  onGoToNext,
  onDownloadItem,
  onDownloadEssentialItem,
  tFocus,
  tAccessibility,
}: FocusModeHeaderProps) {
  const effectiveRating = useEffectiveRating(currentPaper.id);

  return (
    <SheetHeader className="flex-shrink-0 p-3 border-b">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between w-full gap-2 md:gap-0">
        {/* First row: where the paper is in its list, and the rating */}
        <div className="flex items-center justify-between md:justify-start gap-3">
          {/* Named for screen readers only: the row shows the paper's controls. Out of the flow, so it takes no gap. */}
          <SheetTitle className="sr-only">{tAccessibility('focusMode')}</SheetTitle>
          {totalPapers > 1 ? (
            <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              {currentIndex + 1} / {totalPapers}
            </div>
          ) : null}
          {/* Star rating buttons - hidden on mobile */}
          <div className="hidden md:flex items-center gap-0.5">
            <div className="flex items-center gap-1">
              <button
                onClick={() =>
                  onRatingChange(currentPaper.id, "no-rating")
                }
                className="hover:scale-110 transition-transform relative"
              >
                <Star
                  className={cn(
                    "h-3 w-3",
                    effectiveRating === undefined
                      ? "text-rating hover:text-rating"
                      : "text-muted-foreground/40 hover:text-muted-foreground/60"
                  )}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-px bg-muted-foreground/60 rotate-45"></div>
                </div>
              </button>
              <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                X
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onRatingChange(currentPaper.id, "0")}
                className="hover:scale-110 transition-transform"
              >
                <Star
                  className={cn(
                    "h-3 w-3",
                    effectiveRating === 0
                      ? "text-rating hover:text-rating"
                      : "text-muted-foreground hover:text-rating"
                  )}
                />
              </button>
              <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                0
              </span>
            </div>
            {[1, 2, 3, 4, 5].map((star) => (
              <div key={star} className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (effectiveRating === star) {
                      onRatingChange(currentPaper.id, "no-rating");
                    } else {
                      onRatingChange(
                        currentPaper.id,
                        star.toString()
                      );
                    }
                  }}
                  className="hover:scale-110 transition-transform"
                >
                  <Star
                    className={cn(
                      "h-3 w-3",
                      effectiveRating !== undefined &&
                        effectiveRating >= star
                        ? "fill-rating text-rating"
                        : "fill-muted-foreground text-muted-foreground hover:fill-rating hover:text-rating"
                    )}
                  />
                </button>
                <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                  {star}
                </span>
              </div>
            ))}
            <div className="ml-3 flex items-center gap-1">
              <SaveControl paper={currentPaper} />
              <span className="text-xs text-muted-foreground bg-muted px-1 rounded">
                B
              </span>
            </div>
          </div>
        </div>

        {/* Second row: Navigation and actions */}
        {/* Phones wrap this into two rows: rating, save and navigation, then the tools */}
        <div className="flex flex-wrap items-center gap-1 md:flex-nowrap md:justify-end md:mr-8">
          {/* Compact rating selector - only on mobile */}
          <div className="order-1 flex items-center gap-1 md:hidden">
            <RatingSelector paper={currentPaper} variant="compact" />
            <SaveControl paper={currentPaper} compact />
          </div>

          <div className="order-4 flex items-center gap-1 md:order-none">
            <Button
              variant={showTranslated ? "outline-primary" : "outline"}
              size="sm"
              onClick={onToggleTranslation}
              aria-label={
                showTranslated
                  ? tFocus("showOriginal")
                  : tFocus("showTranslation")
              }
              disabled={
                !translatedContent ||
                translatedContent.noTranslationNeeded
              }
            >
              {isTranslating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Globe className="h-3 w-3 md:mr-1" />
                  <span className="hidden sm:inline">
                    {showTranslated ? tFocus("original") : tFocus("translation")}
                  </span>
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
              T
            </span>
            <div className="w-px h-4 bg-border mx-1 hidden md:block"></div>
            <Button
              variant={showSettings ? "outline-primary" : "outline"}
              size="sm"
              onClick={onToggleSettings}
            >
              <Settings className="h-3 w-3" />
            </Button>
            <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
              S
            </span>
          </div>
          {/* One paper has nothing to step to. */}
          {totalPapers > 1 ? (
            <>
              <div className="w-px h-4 bg-border mx-1 hidden md:block"></div>
              <div className="order-2 ml-auto flex items-center gap-1 md:order-none md:ml-0">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onGoToPrevious}
                    disabled={currentIndex === 0}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                    &larr;
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onGoToNext}
                    disabled={currentIndex === totalPapers - 1}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                    &rarr;
                  </span>
                </div>
              </div>
            </>
          ) : null}
          <div className="order-3 basis-full md:hidden" />
          <div className="order-5 w-px h-4 bg-border mx-1 md:order-none"></div>
          <div className="order-6 flex items-center gap-1 md:order-none">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(currentPaper.id, "_blank")}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
              <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                O
              </span>
            </div>
            <CitationControl paper={currentPaper} compact={false} />
            <div className="flex items-center gap-1">
              <DownloadMenu
                variant="icon"
                onDownloadJSON={() => onDownloadItem(currentPaper, "json")}
                onDownloadCSV={() => onDownloadItem(currentPaper, "csv")}
                onDownloadEssentialJSON={() =>
                  onDownloadEssentialItem(currentPaper, "json")
                }
                onDownloadEssentialCSV={() =>
                  onDownloadEssentialItem(currentPaper, "csv")
                }
              />
              <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                D
              </span>
            </div>
            <div className="w-px h-4 bg-border mx-1"></div>
            {/* Closes as the rest of the row acts: an outline button with its key beside it. */}
            <div className="flex items-center gap-1">
              <SheetClose asChild>
                <Button variant="outline" size="sm" aria-label={tAccessibility("closeDialog")}>
                  <X className="h-3 w-3" />
                </Button>
              </SheetClose>
              <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                Esc
              </span>
            </div>
          </div>
        </div>
      </div>
    </SheetHeader>
  );
}
