"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from "motion/react";
import { Search, Loader2, Wand2 } from "@/components/icons";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ModeToggle, SearchMode } from "./ModeToggle";
import { detectSearchMode } from "@/lib/search/detect-mode";
import { useTranslations, useLocale } from "next-intl";
import {
  hintVariants,
  hintTransition,
  submitButtonIconVariants,
  submitButtonTextVariants,
  submitButtonMorphTransition,
} from "@/lib/animation-config";

interface SearchInputProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: (e: React.FormEvent, mode: SearchMode) => void;
  isEnhancing: boolean;
  disabled: boolean;
  className?: string;
}

export function SearchInput({
  query,
  onQueryChange,
  onSubmit,
  isEnhancing,
  disabled,
  className,
}: SearchInputProps) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shouldReduceMotion = useReducedMotion();

  // Manual override: undefined = let auto-detect drive, defined = user's explicit choice
  const [manualMode, setManualMode] = useState<SearchMode | undefined>(undefined);
  const detectedMode = detectSearchMode(query, locale);
  const effectiveMode = manualMode ?? detectedMode;

  // Reset manual override when input is cleared (fresh start)
  useEffect(() => {
    if (!query.trim()) setManualMode(undefined);
  }, [query]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autofocus on desktop (avoid on mobile to prevent keyboard popup)
  useEffect(() => {
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: fine) and (min-width: 768px)").matches;
    if (isDesktop && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleModeChange = (newMode: SearchMode) => {
    setManualMode(newMode);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(e, effectiveMode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const hintAnimTransition = shouldReduceMotion
    ? { duration: 0 }
    : hintTransition;
  const hintAnimVariants = shouldReduceMotion
    ? { enter: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : hintVariants;
  const submitMorphTransition = shouldReduceMotion
    ? { duration: 0 }
    : submitButtonMorphTransition;
  const submitIconVariants = shouldReduceMotion
    ? { enter: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : submitButtonIconVariants;
  const submitTextVariants = shouldReduceMotion
    ? { enter: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : submitButtonTextVariants;

  return (
    <LayoutGroup id="home-search">
      <div
        className={cn(
          "w-full max-w-2xl mx-auto space-y-6 relative z-10",
          className,
        )}
      >
        {/* Mode Toggle */}
        <div className="flex justify-center">
          <ModeToggle
            mode={effectiveMode}
            onModeChange={handleModeChange}
            disabled={disabled}
          />
        </div>

        {/* Input Container */}
        <motion.div
          layout
          className={cn(
            "relative rounded-2xl p-1 transition-[background-color,border-color,box-shadow] duration-300",
            effectiveMode === "research"
              ? "bg-gradient-to-br from-primary/20 via-primary/10 to-transparent shadow-[0_0_30px_-5px] shadow-primary/20"
              : "bg-inset shadow-xl border border-white/20 dark:border-white/5",
          )}
        >
          <div className="relative overflow-hidden rounded-xl bg-field transition-shadow group focus-within:ring-1 focus-within:ring-primary/30">
            <Textarea
              ref={textareaRef}
              name="query"
              value={query}
              placeholder={
                effectiveMode === "research"
                  ? t("researchPlaceholder")
                  : t("searchPlaceholder")
              }
              className="w-full border-none bg-transparent resize-none min-h-[80px] sm:min-h-[100px] max-h-40 text-base sm:text-lg md:text-xl placeholder:text-muted-foreground/50 p-3 focus-visible:ring-0"
              disabled={disabled}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />

            {/* Bottom Action Bar */}
            <div className="flex flex-wrap items-center justify-end md:justify-between p-3 gap-4">
              <div className="text-xs text-muted-foreground hidden md:flex flex-wrap items-center gap-2 shrink-0">
                <span className="px-1.5 py-0.5 rounded-md bg-inset border border-border-subtle font-mono">
                  {t("enterKey")}
                </span>
                {t("toSubmit")}
                <span className="mx-1 opacity-20">|</span>
                <span className="px-1.5 py-0.5 rounded-md bg-inset border border-border-subtle font-mono">
                  {t("shiftEnterKey")}
                </span>
                {t("newLine")}
              </div>

              <Button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || !query.trim()}
                size="lg"
                className={cn(
                  "rounded-xl px-6 min-h-[44px] sm:min-h-0 transition-all duration-300 gap-2 overflow-hidden",
                  effectiveMode === "research"
                    ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25"
                    : "bg-foreground hover:bg-foreground/90 text-background",
                )}
              >
                {isEnhancing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    {tc("processing")}
                  </>
                ) : (
                  <motion.div
                    layout
                    className="relative flex items-center justify-center"
                    transition={{
                      ...submitMorphTransition,
                      layout: { ...submitMorphTransition },
                    }}
                  >
                    <AnimatePresence mode="popLayout">
                      {effectiveMode === "research" ? (
                        <motion.span
                          key="research"
                          layout
                          className="flex items-center justify-center gap-2"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={submitMorphTransition}
                        >
                          <motion.span
                            variants={submitIconVariants}
                            initial="enter"
                            animate="animate"
                            exit="exit"
                            transition={submitMorphTransition}
                            className="inline-flex shrink-0"
                          >
                            <Wand2 className="h-4 w-4" />
                          </motion.span>
                          <motion.span
                            variants={submitTextVariants}
                            initial="enter"
                            animate="animate"
                            exit="exit"
                            transition={submitMorphTransition}
                          >
                            {t("researchButton")}
                          </motion.span>
                        </motion.span>
                      ) : (
                        <motion.span
                          key="search"
                          layout
                          className="flex items-center justify-center gap-2"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={submitMorphTransition}
                        >
                          <motion.span
                            variants={submitIconVariants}
                            initial="enter"
                            animate="animate"
                            exit="exit"
                            transition={submitMorphTransition}
                            className="inline-flex shrink-0"
                          >
                            <Search className="h-4 w-4" />
                          </motion.span>
                          <motion.span
                            variants={submitTextVariants}
                            initial="enter"
                            animate="animate"
                            exit="exit"
                            transition={submitMorphTransition}
                          >
                            {tc("search")}
                          </motion.span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Unified hint area - single AnimatePresence, same height to prevent layout shift */}
        <motion.div
          layout
          className="relative flex justify-center items-center h-11"
          style={{ position: "relative" }}
        >
          <AnimatePresence mode="popLayout">
            {effectiveMode === "search" ? (
              <motion.button
                key="search-hint"
                type="button"
                onClick={() => handleModeChange("research")}
                variants={hintAnimVariants}
                initial="enter"
                animate="animate"
                exit="exit"
                transition={hintAnimTransition}
                className="h-9 flex items-center justify-center gap-2.5 rounded-full border border-border-subtle bg-inset px-3 text-xs text-muted-foreground transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-primary/25 hover:bg-muted hover:text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 sm:text-sm"
              >
                <Wand2 className="h-3.5 w-3.5 text-solid-foreground/70" />
                <span>{t("questionShortcutHint")}</span>
              </motion.button>
            ) : (
              <motion.p
                key="research-hint"
                variants={hintAnimVariants}
                initial="enter"
                animate="animate"
                exit="exit"
                transition={hintAnimTransition}
                className="h-9 flex items-center justify-center text-center text-sm text-primary/80 font-medium"
              >
                {t("researchModeDescription")}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </LayoutGroup>
  );
}
