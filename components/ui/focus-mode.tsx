import React, { useCallback, useEffect, useState, useRef } from "react";
import posthog from "posthog-js";

import { motion, AnimatePresence, PanInfo } from "motion/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ChevronLeft,
  ChevronRight,
  Star,
  BookOpen,
  Award,
  Globe,
  ExternalLink,
  FileText,
  Settings,
  RotateCcw,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { workToCoins, cn } from "@/lib/utils";
import {
  useRatingsStore,
  useFocusModeSettingsStore,
  useUIStore,
} from "@/lib/store";
import { DownloadMenu } from "../download-menu";
import { useTheme } from "next-themes";
import { RatingSelector } from "../rating-selector";
import { useIsMobile } from "@/lib/hooks";
import { useTranslations } from "next-intl";

import { ScreeningResponses, useTranslate } from "../paper-card";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { trimPaperData } from "@/lib/library/trim-paper-data";
import { useAuthReadiness } from "@/components/providers/convex-provider";

interface PaperContentProps {
  paper: any;
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
}

function PaperContent({
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
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {isPreview ? (
            <span className="flex-1 truncate">
              {tFocus("authorsPreview")}
            </span>
          ) : (
            paper.authorships && (
              <span className="flex-1 truncate">
                {paper.authorships
                  .slice(0, 3)
                  .map(
                    (author: { author: { display_name: string } }) =>
                      author.author.display_name
                  )
                  .join(", ")}
                {paper.authorships.length > 3 &&
                  ` +${paper.authorships.length - 3} more`}
              </span>
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
                    : `${paper.cited_by_percentile_year.min}-${paper.cited_by_percentile_year.max}%`}
                </span>
              </span>
            )}
            {(isPreview || paper.primary_topic) && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("topic")}:</span>
                <span className="font-medium">
                  {isPreview
                    ? tFocus("machineLearningPreview")
                    : paper.primary_topic.display_name}
                </span>
              </span>
            )}
            {!isPreview && paper.primary_topic?.field && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("field")}:</span>
                <span className="font-medium">
                  {paper.primary_topic.field.display_name}
                </span>
              </span>
            )}
            {!isPreview && paper.primary_topic?.subfield && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("subfield")}:</span>
                <span className="font-medium">
                  {paper.primary_topic.subfield.display_name}
                </span>
              </span>
            )}
            {!isPreview && paper.primary_topic?.domain && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">{tLabels("domain")}:</span>
                <span className="font-medium">
                  {paper.primary_topic.domain.display_name}
                </span>
              </span>
            )}
            {!isPreview && paper.open_access && paper.open_access.is_oa && (
              <span className="flex items-center gap-1">
                <>
                  <FileText className="h-3 w-3 text-green-600" />
                  <span className="text-green-600 font-medium">{tFocus("pdf")}</span>
                  {paper.open_access.oa_url && (
                    <>
                      <a
                        href={paper.open_access.oa_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
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
                    const doiUrl = paper.doi.startsWith("http")
                      ? paper.doi
                      : `https://doi.org/${paper.doi}`;
                    window.open(doiUrl, "_blank");
                  }}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline cursor-pointer"
                  title={tAccessibility("openDoi")}
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className="font-mono">
                    {paper.doi.replace("https://doi.org/", "")}
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
                      <span
                        key={sdg.id}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-800 rounded-full text-xs"
                        title={tp("sdgWithScoreTooltip", {
                          name: sdg.display_name,
                          scoreLabel: tp("score"),
                          score: sdg.score?.toFixed(2) ?? tCommon("notAvailable"),
                        })}
                      >
                        {sdg.display_name}
                        {sdg.score && (
                          <span className="text-green-600 font-medium">
                            {sdg.score.toFixed(2)}
                          </span>
                        )}
                      </span>
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

interface FocusModeProps {
  isOpen: boolean;
  onClose: () => void;
  papers: any[];
  onDownloadItem: (item: any, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: any, format: "json" | "csv") => void;
}

export function FocusMode({
  isOpen,
  onClose,
  papers,
  onDownloadItem,
  onDownloadEssentialItem,
}: FocusModeProps) {
  const { focusModeIndex: currentIndex, setFocusModeIndex: setCurrentIndex } =
    useUIStore();
  const [showSettings, setShowSettings] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(
    null
  );
  const { ratings, setRating } = useRatingsStore();
  const settings = useFocusModeSettingsStore();
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const { phase } = useAuthReadiness();
  const saveToLibraryMutation = useMutation(api.library.mutations.saveToLibrary);
  const removeFromLibraryMutation = useMutation(api.library.mutations.removeFromLibraryByOpenalexId);

  const tLabels = useTranslations("labels");
  const tAccessibility = useTranslations("accessibility");
  const tFontSize = useTranslations("fontSize");
  const tLineHeight = useTranslations("lineHeight");
  const tWidth = useTranslations("width");
  const tCommon = useTranslations("common");
  const tFocus = useTranslations("focusMode");
  const tp = useTranslations("paperCard");

  // Track focus mode time spent
  const focusModeStartTimeRef = useRef<number | null>(null);
  const entryPaperIdRef = useRef<string | null>(null);
  const currentPaperIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(isOpen);

  const currentPaper = papers[currentIndex];

  const trackFocusModeClosed = () => {
    if (!focusModeStartTimeRef.current) {
      return;
    }

    const entryPaperId = entryPaperIdRef.current ?? currentPaperIdRef.current;
    const exitPaperId = currentPaperIdRef.current ?? entryPaperIdRef.current;

    if (!entryPaperId && !exitPaperId) {
      focusModeStartTimeRef.current = null;
      entryPaperIdRef.current = null;
      currentPaperIdRef.current = null;
      return;
    }

    const timeSpentSeconds = Math.floor(
      (Date.now() - focusModeStartTimeRef.current) / 1000
    );

    posthog.capture("focus_mode_closed", {
      paper_id: entryPaperId ?? exitPaperId,
      entry_paper_id: entryPaperId ?? exitPaperId,
      exit_paper_id: exitPaperId,
      time_spent_seconds: timeSpentSeconds,
    });

    focusModeStartTimeRef.current = null;
    entryPaperIdRef.current = null;
    currentPaperIdRef.current = null;
  };

  // Track open/close transitions and keep the currently visible paper in sync.
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    const isOpening = !wasOpen && isOpen;
    const isClosing = wasOpen && !isOpen;

    if (isOpening) {
      const activePaperId = currentPaper?.id ?? null;
      focusModeStartTimeRef.current = Date.now();
      entryPaperIdRef.current = activePaperId;
      currentPaperIdRef.current = activePaperId;
    }

    if (isOpen && currentPaper?.id) {
      currentPaperIdRef.current = currentPaper.id;
    }

    if (isClosing) {
      trackFocusModeClosed();
    }

    wasOpenRef.current = isOpen;
  }, [isOpen, currentPaper?.id]);

  // Unmount fallback: capture close if the component unmounts while still open.
  useEffect(() => {
    return () => {
      if (wasOpenRef.current) {
        trackFocusModeClosed();
      }
    };
  }, []);

  // Swipe threshold for triggering navigation - made more restrictive
  const swipeThreshold = 120; // Increased from 50
  const swipeVelocityThreshold = 800; // Increased from 500

  // Helper functions for styling based on settings
  const getFontSizeClass = () => {
    return cn(
      settings.fontSize === "sm" && "text-sm",
      settings.fontSize === "base" && "text-base",
      settings.fontSize === "lg" && "text-lg",
      settings.fontSize === "xl" && "text-xl",
      !["sm", "base", "lg", "xl"].includes(settings.fontSize) && "text-base" // default fallback
    );
  };

  const getLineHeightClass = () => {
    return cn(
      settings.lineHeight === "tight" && "leading-tight",
      settings.lineHeight === "normal" && "leading-normal",
      settings.lineHeight === "relaxed" && "leading-relaxed",
      !["tight", "normal", "relaxed"].includes(settings.lineHeight) &&
        "leading-normal" // default fallback
    );
  };

  const getMaxWidthClass = () => {
    return cn(
      settings.maxContentWidth === "narrow" && "max-w-2xl",
      settings.maxContentWidth === "medium" && "max-w-4xl",
      settings.maxContentWidth === "wide" && "max-w-6xl",
      settings.maxContentWidth === "full" && "max-w-none",
      !["narrow", "medium", "wide", "full"].includes(
        settings.maxContentWidth
      ) && "max-w-4xl" // default fallback
    );
  };

  const getContainerClasses = () => {
    const baseClasses =
      "flex-1 overflow-y-auto overflow-x-hidden focus:outline-none";
    return baseClasses;
  };

  const getContentClasses = () => {
    return cn(
      "min-h-full flex flex-col mx-auto",
      getMaxWidthClass(),
      settings.compactMode ? "p-3" : "p-6",
      settings.compactMode ? "space-y-1" : "space-y-2"
    );
  };

  const {
    translatedContent,
    showTranslated,
    isTranslating,
    setShowTranslated,
  } = useTranslate(currentPaper);

  // Reset scroll position when paper changes
  useEffect(() => {
    if (isOpen && !showSettings) {
      const contentContainer = document.querySelector(
        "[data-content-scroll]"
      ) as HTMLElement;
      if (contentContainer) {
        contentContainer.scrollTop = 0;
      }
    }
  }, [currentIndex, isOpen, showSettings]);

  const handleRatingChange = useCallback(
    (paperId: string, rating: string) => {
      const newRating = rating === "no-rating" ? null : parseInt(rating);

      // 1. Always update Zustand (optimistic, localStorage)
      if (rating === "no-rating") {
        setRating(paperId, null);
      } else {
        setRating(paperId, parseInt(rating));
      }

      // 2. If signed-in: save to library on rate, remove from library on clear
      if (phase === "authenticated" && newRating !== null) {
        // Find the paper object from the papers array
        const paper = papers.find((p: any) => p.id === paperId);
        if (paper) {
          const trimmed = trimPaperData(paper);
          saveToLibraryMutation({
            ...trimmed,
            rating: newRating,
          }).catch((error) => {
            console.error("[Library] Failed to save to library:", error);
          });
        }
      } else if (phase === "authenticated" && newRating === null) {
        removeFromLibraryMutation({ openalexId: paperId }).catch((error) => {
          console.error("[Library] Failed to remove from library:", error);
        });
      }
    },
    [setRating, phase, papers, saveToLibraryMutation, removeFromLibraryMutation]
  );

  const goToNext = () => {
    if (currentIndex < papers.length - 1) {
      if (isMobile) {
        setSwipeDirection("left");
      }
      const nextPaper = papers[currentIndex + 1];
      setCurrentIndex((prev) => prev + 1);

      // Track focus mode navigation
      posthog.capture("focus_mode_navigation", {
        direction: "next",
        current_paper_id: currentPaper?.id,
        next_paper_id: nextPaper?.id,
      });
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      if (isMobile) {
        setSwipeDirection("right");
      }
      const previousPaper = papers[currentIndex - 1];
      setCurrentIndex((prev) => prev - 1);

      // Track focus mode navigation
      posthog.capture("focus_mode_navigation", {
        direction: "previous",
        current_paper_id: currentPaper?.id,
        next_paper_id: previousPaper?.id,
      });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goToPrevious();
          break;
        case "ArrowRight":
          e.preventDefault();
          goToNext();
          break;
        case "ArrowUp":
        case "ArrowDown":
          // Focus the abstract container and let the browser handle scrolling
          const abstractContainer = document.querySelector(
            "[data-content-scroll]"
          ) as HTMLElement;
          if (abstractContainer && !abstractContainer.matches(":focus")) {
            abstractContainer.focus();
          }
          // Don't prevent default - let the browser handle the scrolling
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "d":
        case "D":
          e.preventDefault();
          // Download JSON directly
          onDownloadItem(currentPaper, "json");
          break;
        case "o":
        case "O":
          e.preventDefault();
          window.open(currentPaper.id, "_blank");
          break;
        case "a":
        case "A":
          e.preventDefault();
          if (currentPaper.open_access?.oa_url) {
            window.open(currentPaper.open_access.oa_url, "_blank");
          }
          break;
        case "i":
        case "I":
          e.preventDefault();
          if (currentPaper.doi) {
            const doiUrl = currentPaper.doi.startsWith("http")
              ? currentPaper.doi
              : `https://doi.org/${currentPaper.doi}`;
            window.open(doiUrl, "_blank");
          }
          break;
        case "x":
        case "X":
          e.preventDefault();
          handleRatingChange(currentPaper.id, "no-rating");
          break;
        case "0":
          e.preventDefault();
          handleRatingChange(currentPaper.id, "0");
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
          e.preventDefault();
          handleRatingChange(currentPaper.id, e.key);
          break;
        case "s":
        case "S":
          e.preventDefault();
          setShowSettings(!showSettings);
          break;
        case "t":
        case "T":
          e.preventDefault();
          if (translatedContent) {
            setShowTranslated(!showTranslated);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    currentIndex,
    papers.length,
    currentPaper,
    translatedContent,
    showTranslated,
    handleRatingChange,
  ]);

  const goToIndex = (index: number) => {
    if (index !== currentIndex) {
      if (isMobile) {
        setSwipeDirection(index > currentIndex ? "left" : "right");
      }
      setCurrentIndex(index);
    }
  };

  // Swipe handlers
  const handleDragEnd = (event: any, info: PanInfo) => {
    const { offset, velocity } = info;

    // More restrictive swipe detection
    const horizontalDistance = Math.abs(offset.x);
    const verticalDistance = Math.abs(offset.y);
    const horizontalVelocity = Math.abs(velocity.x);
    const verticalVelocity = Math.abs(velocity.y);

    // Only trigger swipe if:
    // 1. Horizontal movement is significantly more than vertical (intentional horizontal swipe)
    // 2. Meets distance OR velocity threshold
    // 3. Horizontal velocity is greater than vertical velocity (horizontal intent)
    const isHorizontalSwipe = horizontalDistance > verticalDistance * 1.5;
    const meetsThreshold =
      horizontalDistance > swipeThreshold ||
      horizontalVelocity > swipeVelocityThreshold;
    const isHorizontalIntent = horizontalVelocity > verticalVelocity;

    const shouldSwipe =
      isHorizontalSwipe && meetsThreshold && isHorizontalIntent;

    if (shouldSwipe) {
      if (offset.x > 0 && currentIndex > 0) {
        // Swipe right - go to previous
        goToPrevious();
      } else if (offset.x < 0 && currentIndex < papers.length - 1) {
        // Swipe left - go to next
        goToNext();
      }
    }
  };

  const paperContentProps: Omit<PaperContentProps, "paper" | "isPreview"> = {
    contentClasses: getContentClasses(),
    fontSizeClass: getFontSizeClass(),
    lineHeightClass: getLineHeightClass(),
    settings: {
      compactMode: settings.compactMode,
      showMetadata: settings.showMetadata,
    },
    showTranslated,
    translatedContent,
    tFocus: tFocus as (key: string) => string,
    tLabels: tLabels as (key: string) => string,
    tCommon: tCommon as (key: string) => string,
    tp: tp as (key: string, opts?: Record<string, unknown>) => string,
    tAccessibility: tAccessibility as (key: string) => string,
    isOpen,
  };

  if (!currentPaper) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-none p-0 overflow-hidden !outline-none"
      >
        <div className="flex flex-col h-full">
          {/* Compact Header */}
          <SheetHeader className="flex-shrink-0 p-3 border-b">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between w-full gap-2 md:gap-0">
              {/* First row: Focus Mode title + rating */}
              <div className="flex items-center justify-between md:justify-start gap-3">
                <div className="flex items-center gap-3">
                  <SheetTitle className="text-lg">{tAccessibility('focusMode')}</SheetTitle>
                  <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    {currentIndex + 1} / {papers.length}
                  </div>
                </div>
                {/* Star rating buttons - hidden on mobile */}
                <div className="hidden md:flex items-center gap-0.5 mr-8 md:mr-0">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        handleRatingChange(currentPaper.id, "no-rating")
                      }
                      className="hover:scale-110 transition-transform relative"
                    >
                      <Star
                        className={cn(
                          "h-3 w-3",
                          ratings[currentPaper.id] === undefined
                            ? "text-yellow-400 hover:text-yellow-400"
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
                      onClick={() => handleRatingChange(currentPaper.id, "0")}
                      className="hover:scale-110 transition-transform"
                    >
                      <Star
                        className={cn(
                          "h-3 w-3",
                          ratings[currentPaper.id] === 0
                            ? "text-yellow-400 hover:text-yellow-400"
                            : "text-muted-foreground hover:text-yellow-400"
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
                          const currentRating = ratings[currentPaper.id];
                          if (currentRating === star) {
                            // Remove rating if clicking the same star
                            handleRatingChange(currentPaper.id, "no-rating");
                          } else {
                            // Set new rating
                            handleRatingChange(
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
                            ratings[currentPaper.id] &&
                              ratings[currentPaper.id] >= star
                              ? "fill-yellow-400 text-yellow-400"
                              : "fill-muted-foreground text-muted-foreground hover:fill-yellow-400 hover:text-yellow-400"
                          )}
                        />
                      </button>
                      <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                        {star}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Second row: Navigation and actions */}
              <div className="flex items-center justify-center md:justify-end gap-1 md:mr-8">
                {/* Compact rating selector - only on mobile */}
                <div className="md:hidden">
                  <RatingSelector paperId={currentPaper.id} paperResult={currentPaper} variant="compact" />
                </div>
                <div className="w-px h-4 bg-border mx-1 md:hidden"></div>

                <div className="flex items-center gap-1">
                  <Button
                    variant={showTranslated ? "outline-primary" : "outline"}
                    size="sm"
                    onClick={() => setShowTranslated(!showTranslated)}
                    title={
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
                    onClick={() => setShowSettings(!showSettings)}
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                    S
                  </span>
                </div>
                <div className="w-px h-4 bg-border mx-1"></div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToPrevious}
                    disabled={currentIndex === 0}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                    ←
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToNext}
                    disabled={currentIndex === papers.length - 1}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">
                    →
                  </span>
                </div>
                <div className="w-px h-4 bg-border mx-1"></div>
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
              </div>
            </div>
          </SheetHeader>

          {/* Main Content */}
          <div className={getContainerClasses()} tabIndex={0}>
            {showSettings ? (
              /* Settings Panel */
              <div
                className="h-full overflow-y-auto !outline-none"
                data-content-scroll
                tabIndex={0}
              >
                <div className={cn("mx-auto p-6", getMaxWidthClass())}>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">
                        {tFocus("settingsTitle")}
                      </h2>
                      <p className="text-muted-foreground mt-1">
                        {tFocus("settingsSubtitle")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={settings.resetSettings}
                      className="gap-2"
                      title={tAccessibility('resetToDefaults')}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {tCommon("reset")}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Settings Controls */}
                    <div className="space-y-8">
                      {/* Typography Section */}
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-lg font-semibold mb-1">
                            {tFocus("typography")}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {tFocus("typographyDescription")}
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              {tFocus("fontSize")}
                            </Label>
                            <Select
                              value={settings.fontSize}
                              onValueChange={settings.setFontSize}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="sm">{tFontSize('small')}</SelectItem>
                                <SelectItem value="base">
                                  {tFontSize('medium')}
                                </SelectItem>
                                <SelectItem value="lg">{tFontSize('large')}</SelectItem>
                                <SelectItem value="xl">
                                  {tFontSize('extraLarge')}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              {tFocus("lineHeight")}
                            </Label>
                            <Select
                              value={settings.lineHeight}
                              onValueChange={settings.setLineHeight}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="tight">
                                  {tLineHeight('tight')}
                                </SelectItem>
                                <SelectItem value="normal">
                                  {tLineHeight('normal')}
                                </SelectItem>
                                <SelectItem value="relaxed">
                                  {tLineHeight('relaxed')}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Layout Section */}
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-lg font-semibold mb-1">{tFocus("layout")}</h3>
                          <p className="text-sm text-muted-foreground">
                            {tFocus("layoutDescription")}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm font-medium">
                            {tFocus("contentWidth")}
                          </Label>
                          <Select
                            value={settings.maxContentWidth}
                            onValueChange={settings.setMaxContentWidth}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="narrow">
                                  {tWidth('narrow')}
                                </SelectItem>
                                <SelectItem value="medium">
                                  {tWidth('medium')}
                                </SelectItem>
                                <SelectItem value="wide">
                                  {tWidth('wide')}
                                </SelectItem>
                                <SelectItem value="full">{tWidth('fullWidth')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Appearance Section */}
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-lg font-semibold mb-1">
                            {tFocus("appearance")}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {tFocus("appearanceDescription")}
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-medium">
                                {tFocus("darkMode")}
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                {tFocus("darkModeDescription")}
                              </p>
                            </div>
                            <Switch
                              checked={theme === "dark"}
                              onCheckedChange={() =>
                                setTheme(theme === "dark" ? "light" : "dark")
                              }
                            />
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-medium">
                                {tFocus("showMetadata")}
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                {tFocus("showMetadataDescription")}
                              </p>
                            </div>
                            <Switch
                              checked={settings.showMetadata}
                              onCheckedChange={settings.setShowMetadata}
                            />
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-medium">
                                {tFocus("compactMode")}
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                {tFocus("compactModeDescription")}
                              </p>
                            </div>
                            <Switch
                              checked={settings.compactMode}
                              onCheckedChange={settings.setCompactMode}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Preview Section */}
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold mb-1">{tFocus("preview")}</h3>
                        <p className="text-sm text-muted-foreground">
                          {tFocus("previewDescription")}
                        </p>
                      </div>

                      <div className="rounded-lg border bg-background">
                        <PaperContent
                          paper={currentPaper}
                          isPreview={true}
                          {...paperContentProps}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Back Button */}
                  <div className="mt-8 pt-6 border-t">
                    <Button
                      onClick={() => setShowSettings(false)}
                      className="w-full sm:w-auto gap-2"
                      size="lg"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      {tFocus("backToContent")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* Paper Content with Swipe Animation */
              <div
                className="relative h-full overflow-x-hidden !outline-none"
                data-content-scroll
                tabIndex={0}
              >
                {isMobile ? (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentIndex}
                      initial={{
                        x:
                          swipeDirection === "left"
                            ? 300
                            : swipeDirection === "right"
                            ? -300
                            : 0,
                        opacity: 0,
                      }}
                      animate={{
                        x: 0,
                        opacity: 1,
                      }}
                      exit={{
                        x:
                          swipeDirection === "left"
                            ? -300
                            : swipeDirection === "right"
                            ? 300
                            : 0,
                        opacity: 0,
                      }}
                      transition={{
                        type: "tween",
                        duration: 0.15,
                        ease: "easeOut",
                      }}
                      onAnimationComplete={() => setSwipeDirection(null)}
                      drag="x"
                      dragConstraints={{ left: 0, right: 0 }}
                      dragElastic={0.1}
                      onDragEnd={handleDragEnd}
                      className="h-full cursor-grab active:cursor-grabbing"
                      style={{ touchAction: "pan-y" }}
                    >
                      <PaperContent
                      key={currentIndex}
                      paper={currentPaper}
                      {...paperContentProps}
                    />
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  /* Desktop - No Animation */
                  <div className="h-full">
                    <PaperContent
                      key={currentIndex}
                      paper={currentPaper}
                      {...paperContentProps}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
