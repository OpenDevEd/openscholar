"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import { useSearchHistoryStore, useUIStore } from "@/lib/store";
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
  /**
   * For building a query, not acting on results: leaves out downloads, the
   * share link, results translation and screening. The question, AI help,
   * query translation and query history all stay.
   */
  queryOnly?: boolean;
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
  queryOnly = false,
}: SearchCommandCenterProps) {
  const [mode, setMode] = useState<CommandCenterMode>("search");
  const screenStateKey = searchId || "__active";
  const screeningPanelId = `screening-panel-${searchId || "active"}`;
  const isScreeningOpen = useUIStore(
    (state) => state.screeningPanelOpenBySearchId[screenStateKey] || false
  );
  const toggleScreeningPanel = useUIStore((state) => state.toggleScreeningPanel);
  const screeningQuestionCount = useSearchHistoryStore(
    (state) =>
      state.searchHistory.find((item) => item.id === searchId)?.screeningQuestions
        ?.length || 0
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={subtleSpring}
      className={cn(
        "command-center relative rounded-2xl overflow-hidden",
        "bg-background/95 dark:bg-background/90",
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
        queryOnly={queryOnly}
      />

      {/* Body - switches between search and adjust modes */}
      <SearchCommandBody
        mode={mode}
        searchId={searchId}
        currentQuery={currentQuery}
        allowEmpty={queryOnly}
        isLoading={isLoading}
        isValidating={isValidating}
      />

      {/* Footer with results count and screening toggle */}
      <SearchCommandFooter
        totalCount={totalCount}
        currentQuery={currentQuery}
        isScreeningOpen={isScreeningOpen}
        onScreeningToggle={() => toggleScreeningPanel(screenStateKey)}
        screeningPanelId={screeningPanelId}
        screeningQuestionCount={screeningQuestionCount}
        searchId={searchId}
        isLoading={isLoading || isValidating}
        queryOnly={queryOnly}
      />

      {/* Screening panel expansion */}
      {!queryOnly && (
        <ScreeningExpansion
          isOpen={isScreeningOpen}
          searchId={searchId}
          panelId={screeningPanelId}
        />
      )}
    </motion.div>
  );
}
