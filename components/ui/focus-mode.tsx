import React, { useCallback, useEffect, useState, useRef } from "react";
import posthog from "posthog-js";

import { motion, AnimatePresence, PanInfo } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  useFocusModeSettingsStore,
  useUIStore,
} from "@/lib/store";
import { useTheme } from "next-themes";
import { useIsMobile } from "@/lib/hooks";
import { useTranslations } from "next-intl";

import { useTranslate } from "../paper-card";
import { useAuthorFilter } from "../paper-card/hooks";

import { PaperContent } from "@/components/focus-mode/paper-content";
import type { PaperContentProps } from "@/components/focus-mode/paper-content";
import { FocusModeHeader } from "@/components/focus-mode/focus-mode-header";
import { useSavePaper } from "@/components/library/save-control";
import { useRatePaper } from "@/components/rating-selector";
import { FocusModeSettings } from "@/components/focus-mode/focus-mode-settings";
import type { PaperResult } from "@/lib/types";

interface FocusModeProps {
  isOpen: boolean;
  onClose: () => void;
  papers: PaperResult[];
  onDownloadItem: (item: PaperResult, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: PaperResult, format: "json" | "csv") => void;
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
  const settings = useFocusModeSettingsStore();
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const ratePaper = useRatePaper();

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
  const savePaper = useSavePaper(currentPaper);
  const authorFilter = useAuthorFilter();

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
      const paper = papers.find((p) => p.id === paperId);
      if (paper) ratePaper(paper, rating === "no-rating" ? null : parseInt(rating));
    },
    [papers, ratePaper]
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
        case "b":
        case "B":
          e.preventDefault();
          savePaper.toggle();
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
    savePaper.toggle,
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
  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
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
    selectedAuthors: authorFilter.authors,
    // The paper being read may not be in the new results, so a change to the search closes focus mode.
    onToggleAuthor: authorFilter.toggle && ((author) => {
      onClose();
      authorFilter.toggle?.(author);
    }),
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
          <FocusModeHeader
            currentPaper={currentPaper}
            currentIndex={currentIndex}
            totalPapers={papers.length}
            showSettings={showSettings}
            showTranslated={showTranslated}
            translatedContent={translatedContent}
            isTranslating={isTranslating}
            isMobile={isMobile}
            onRatingChange={handleRatingChange}
            onToggleTranslation={() => setShowTranslated(!showTranslated)}
            onToggleSettings={() => setShowSettings(!showSettings)}
            onGoToPrevious={goToPrevious}
            onGoToNext={goToNext}
            onDownloadItem={onDownloadItem}
            onDownloadEssentialItem={onDownloadEssentialItem}
            tFocus={tFocus as (key: string) => string}
            tAccessibility={tAccessibility as (key: string) => string}
          />

          {/* Main Content */}
          <div className={getContainerClasses()} tabIndex={0}>
            {showSettings ? (
              <FocusModeSettings
                settings={settings}
                theme={theme}
                setTheme={setTheme}
                maxWidthClass={getMaxWidthClass()}
                currentPaper={currentPaper}
                paperContentProps={paperContentProps}
                onBack={() => setShowSettings(false)}
                tFocus={tFocus as (key: string) => string}
                tFontSize={tFontSize as (key: string) => string}
                tLineHeight={tLineHeight as (key: string) => string}
                tWidth={tWidth as (key: string) => string}
                tCommon={tCommon as (key: string) => string}
                tAccessibility={tAccessibility as (key: string) => string}
              />
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
