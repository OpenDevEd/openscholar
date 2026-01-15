"use client";

import React from "react";
import { PaperCardListDetail } from "./paper-card-list-detail";
import { PaperCardListSimple } from "./paper-card-list-simple";
import { PaperCardGrid } from "./paper-card-grid";
import type { PaperCardProps } from "./shared";
import type { ViewMode } from "@/lib/types";

// Re-export hooks and components for backwards compatibility
export { useTranslate, useScreening, useCitationHandlers, usePaperCardData } from "./hooks";
export { ScreeningResponses, TranslationToggle } from "./shared";
export type { PaperCardProps } from "./shared";

interface PaperCardWithModeProps extends PaperCardProps {
  viewMode?: ViewMode;
}

export function PaperCard({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
  viewMode = "list-detail",
}: PaperCardWithModeProps) {
  switch (viewMode) {
    case "list-simple":
      return (
        <PaperCardListSimple
          result={result}
          resultIndex={resultIndex}
          onDownloadItem={onDownloadItem}
          onDownloadEssentialItem={onDownloadEssentialItem}
        />
      );
    case "grid-2":
    case "grid-3":
      return (
        <PaperCardGrid
          result={result}
          resultIndex={resultIndex}
          onDownloadItem={onDownloadItem}
          onDownloadEssentialItem={onDownloadEssentialItem}
          viewMode={viewMode}
        />
      );
    case "list-detail":
    default:
      return (
        <PaperCardListDetail
          result={result}
          resultIndex={resultIndex}
          onDownloadItem={onDownloadItem}
          onDownloadEssentialItem={onDownloadEssentialItem}
        />
      );
  }
}

// Default export for backwards compatibility
export default PaperCard;
