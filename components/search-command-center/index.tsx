"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import { SearchCommandHeader } from "./search-command-header";
import { SearchCommandBody } from "./search-command-body";
import { SearchCommandFooter } from "./search-command-footer";
import { ScreeningExpansion } from "./screening-expansion";

export type { CommandCenterMode } from "./types";
import type { CommandCenterMode } from "./types";

interface SearchCommandCenterProps {
  searchId: string;
  totalCount: number;
  currentQuery: string;
  isLoading?: boolean;
  isValidating?: boolean;
  onDownloadAllJSON?: () => void;
  onDownloadAllCSV?: () => void;
  onDownloadAllEssentialJSON?: () => void;
  onDownloadAllEssentialCSV?: () => void;
}

export function SearchCommandCenter({
  searchId,
  totalCount,
  currentQuery,
  isLoading = false,
  isValidating = false,
  onDownloadAllJSON,
  onDownloadAllCSV,
  onDownloadAllEssentialJSON,
  onDownloadAllEssentialCSV,
}: SearchCommandCenterProps) {
  const [mode, setMode] = useState<CommandCenterMode>("search");
  const [isScreeningOpen, setIsScreeningOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={subtleSpring}
      className={cn(
        "command-center relative rounded-2xl overflow-hidden",
        "bg-background/80 dark:bg-background/60",
        "backdrop-blur-xl backdrop-saturate-150",
        "border border-border/50",
        "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
        "transition-shadow duration-300",
        "focus-within:shadow-xl focus-within:shadow-primary/[0.05]",
        "focus-within:border-primary/20"
      )}
    >
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

      {/* Header with mode tabs and actions */}
      <SearchCommandHeader
        mode={mode}
        onModeChange={setMode}
        onDownloadAllJSON={onDownloadAllJSON}
        onDownloadAllCSV={onDownloadAllCSV}
        onDownloadAllEssentialJSON={onDownloadAllEssentialJSON}
        onDownloadAllEssentialCSV={onDownloadAllEssentialCSV}
        isLoading={isLoading || isValidating}
      />

      {/* Body - switches between search and adjust modes */}
      <SearchCommandBody
        mode={mode}
        searchId={searchId}
        currentQuery={currentQuery}
        isLoading={isLoading}
        isValidating={isValidating}
      />

      {/* Footer with results count and screening toggle */}
      <SearchCommandFooter
        totalCount={totalCount}
        currentQuery={currentQuery}
        isScreeningOpen={isScreeningOpen}
        onScreeningToggle={() => setIsScreeningOpen(!isScreeningOpen)}
        isLoading={isLoading || isValidating}
      />

      {/* Screening panel expansion */}
      <ScreeningExpansion
        isOpen={isScreeningOpen}
        searchId={searchId}
      />
    </motion.div>
  );
}
