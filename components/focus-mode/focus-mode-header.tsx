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
  ExternalLink,
  Settings,
  X,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { DownloadMenu } from "@/components/download-menu";
import { RatingSelector } from "@/components/rating-selector";
import { SaveControl } from "@/components/library/save-control";
import { useEffectiveRating } from "@/components/results-contexts";
import type { PaperResult } from "@/lib/types";
import { saveablePaper, toPaperKey } from "@/lib/papers/paper-ref";
import { ItemPresence } from "@/components/workspaces/presence";
import { usePaperPage } from "@/lib/papers/use-paper-page";
import { FocusTranslationControl } from "./focus-translation-control";

export interface FocusModeHeaderProps {
  currentPaper: PaperResult;
  currentIndex: number;
  totalPapers: number;
  showSettings: boolean;
  showTranslated: boolean;
  translatedContent: { translatedTitle: string; translatedAbstract: string; noTranslationNeeded?: boolean } | null;
  isTranslating: boolean;
  listedPapers: PaperResult[];
  translationMenuOpen: boolean;
  onTranslationMenuOpenChange: (open: boolean) => void;
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
  listedPapers,
  translationMenuOpen,
  onTranslationMenuOpenChange,
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
  // Any paper named by its source but an upload is rated and saved (an upload's file stays with its job); it opens where its source keeps it, if anywhere.
  const saveable = saveablePaper(currentPaper.id);
  // Who else in the workspace is reading it is read by the paper's key, wherever they opened it.
  const key = toPaperKey(currentPaper.id, { pdfUrl: currentPaper.primary_location?.pdf_url });
  const page = usePaperPage(currentPaper.id, currentPaper.primary_location?.pdf_url);
  const hasTranslation = !!translatedContent && !translatedContent.noTranslationNeeded;
  const previous = (
    <Button variant="outline" size="icon-sm" onClick={onGoToPrevious} disabled={currentIndex === 0}>
      <ChevronLeft className="h-3 w-3" />
    </Button>
  );
  const next = (
    <Button variant="outline" size="icon-sm" onClick={onGoToNext} disabled={currentIndex === totalPapers - 1}>
      <ChevronRight className="h-3 w-3" />
    </Button>
  );
  const close = (
    <SheetClose asChild>
      <Button variant="outline" size="icon-sm" aria-label={tAccessibility("closeDialog")}>
        <X className="h-3 w-3" />
      </Button>
    </SheetClose>
  );

  return (
    <SheetHeader className="flex-shrink-0 p-3 border-b">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between w-full gap-2 lg:gap-0">
        {/* First row: where the paper is in its list, and the rating. Phones step and close here, Close in the corner. */}
        <div className="flex items-center gap-1 lg:gap-3">
          {/* Named for screen readers only: the row shows the paper's controls. Out of the flow, so it takes no gap. */}
          <SheetTitle className="sr-only">{tAccessibility('focusMode')}</SheetTitle>
          {totalPapers > 1 ? (
            <>
              {/* The count sits after both arrows, so its width never moves an arrow from under a finger. */}
              <div className="flex items-center gap-1 lg:hidden">
                {previous}
                {next}
              </div>
              <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded tabular-nums whitespace-nowrap max-lg:ms-1">
                {currentIndex + 1} / {totalPapers}
              </div>
            </>
          ) : null}
          {/* Who else is reading it sits beside Close on a phone and first among the tools on a wider screen, where it keeps the person in the paper's room; here it only reads. Faces arriving grow into the free space, so nothing moves. */}
          <div className="ms-auto flex items-center gap-2 lg:hidden">
            {key ? <ItemPresence kind="paper" id={key} join={false} /> : null}
            {close}
          </div>
          {/* Star rating buttons - hidden on mobile */}
          {saveable ? (
            <div className="hidden lg:flex items-center gap-0.5">
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
              <div className="ms-3 flex items-center gap-1">
                <SaveControl paper={currentPaper} />
                <span className="text-xs text-muted-foreground bg-muted px-1 rounded">
                  B
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Second row: actions. Phones show the rating and save on the left and the tools on the right. */}
        <div className="flex flex-wrap items-center gap-1 lg:flex-nowrap lg:justify-end lg:me-8">
          {/* Compact rating selector - only on mobile */}
          {saveable ? (
            <div className="flex items-center gap-1 lg:hidden">
              <RatingSelector paper={currentPaper} variant="compact" />
              <SaveControl paper={currentPaper} compact />
            </div>
          ) : null}

          {/* The tools stay together, so a row too narrow for them moves them to a line of their own. */}
          <div className="ms-auto flex items-center gap-1 lg:ms-0">
            {key ? (
              <span className="me-2 hidden lg:flex">
                <ItemPresence kind="paper" id={key} />
              </span>
            ) : null}
            <div className="flex items-center gap-1">
              <FocusTranslationControl
                paper={currentPaper}
                listedPapers={listedPapers}
                open={translationMenuOpen}
                onOpenChange={onTranslationMenuOpenChange}
                hasTranslation={hasTranslation}
                showTranslated={showTranslated}
                isTranslating={isTranslating}
                onToggleTranslation={onToggleTranslation}
                tFocus={tFocus}
              />
              <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden xl:inline">
                T
              </span>
              <div className="w-px h-4 bg-border mx-1 hidden lg:block"></div>
              <Button
                variant={showSettings ? "outline-primary" : "outline"}
                size="icon-sm"
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
                <div className="w-px h-4 bg-border mx-1 hidden lg:block"></div>
                <div className="hidden lg:flex items-center gap-1">
                  <div className="flex items-center gap-1">
                    {previous}
                    <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                      &larr;
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {next}
                    <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                      &rarr;
                    </span>
                  </div>
                </div>
              </>
            ) : null}
            <div className="w-px h-4 bg-border mx-1 hidden lg:block"></div>
            <div className="flex items-center gap-1">
              {page ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => window.open(page!, "_blank")}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                    O
                  </span>
                </div>
              ) : null}
              <CitationControl paper={currentPaper} compact={false} />
              <div className="flex items-center gap-1">
                <DownloadMenu
                  variant="outline"
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
              <div className="w-px h-4 bg-border mx-1 hidden lg:block"></div>
              {/* Closes as the rest of the row acts: an outline button with its key beside it. */}
              <div className="hidden lg:flex items-center gap-1">
                {close}
                <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                  Esc
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SheetHeader>
  );
}
