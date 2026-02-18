"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Loader2, ArrowRight, Wand2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ModeToggle, SearchMode } from "./ModeToggle";
import { useTranslations } from "next-intl";

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

  // Detect mode based on input ("?" at end) or manual toggle
  // Initialize with "search" but sync with query
  const [mode, setMode] = useState<SearchMode>("search");

  // Auto-switch to research mode if query ends with '?'
  useEffect(() => {
    if (query.trim().endsWith("?")) {
      setMode("research");
    }
  }, [query]);

  const handleModeChange = (newMode: SearchMode) => {
    setMode(newMode);
    // Focus textarea on toggle? Maybe.
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(e, mode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div
      className={cn(
        "w-full max-w-2xl mx-auto space-y-6 relative z-10",
        className,
      )}
    >
      {/* Mode Toggle */}
      <div className="flex justify-center">
        <ModeToggle
          mode={mode}
          onModeChange={handleModeChange}
          disabled={disabled}
        />
      </div>

      {/* Input Container */}
      <motion.div
        layout
        className={cn(
          "relative rounded-2xl p-1 transition-all duration-300",
          mode === "research"
            ? "bg-gradient-to-br from-primary/20 via-primary/10 to-transparent shadow-[0_0_30px_-5px_oklch(0.7_0.17_54/0.2)]"
            : "bg-background/40 shadow-xl border border-white/20 dark:border-white/5",
        )}
      >
        <div className="relative bg-background/80 dark:bg-background/60 backdrop-blur-xl rounded-xl overflow-hidden group focus-within:ring-1 focus-within:ring-primary/30 transition-shadow">
          <Textarea
            name="query"
            value={query}
            placeholder={
              mode === "research"
                ? t("researchPlaceholder")
                : t("searchPlaceholder")
            }
            className="w-full border-none bg-transparent resize-none min-h-[100px] max-h-40 text-lg md:text-xl placeholder:text-muted-foreground/50 p-3 focus-visible:ring-0"
            disabled={disabled}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />

          {/* Bottom Action Bar */}
          <div className="flex items-center justify-end md:justify-between p-3 pl-5 gap-4">
            <div className="text-xs text-muted-foreground hidden md:flex items-center gap-2 shrink-0">
              <span className="px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 font-mono">
                Enter
              </span>
              {t("toSubmit")}
              <span className="mx-1 opacity-20">|</span>
              <span className="px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 font-mono">
                Shift + Enter
              </span>
              {t("newLine")}
              {mode === "search" && (
                <>
                  <span className="mx-1 opacity-20">|</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 font-mono">
                    ?
                  </span>
                  {t("forResearch")}
                </>
              )}
            </div>

            <Button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || !query.trim()}
              size="lg"
              className={cn(
                "rounded-xl px-6 transition-all duration-300 gap-2",
                mode === "research"
                  ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25"
                  : "bg-foreground hover:bg-foreground/90 text-background",
              )}
            >
              {isEnhancing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tc("processing")}
                </>
              ) : (
                <>
                  {mode === "research" ? (
                    <Wand2 className="h-4 w-4" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  {mode === "research" ? "Research" : tc("search")}
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Research Mode Hint */}
      <AnimatePresence>
        {mode === "research" && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-center text-sm text-primary/80 font-medium"
          >
            {t("researchModeDescription")}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
