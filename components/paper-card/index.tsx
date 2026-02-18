"use client";

import React from "react";
import { PaperCardListDetail } from "./paper-card-list-detail";
import { PaperCardListSimple } from "./paper-card-list-simple";
import { PaperCardGrid } from "./paper-card-grid";
import type { PaperCardProps } from "./shared";
import type { ViewMode } from "@/lib/types";

// Re-export for consumers (focus-mode, etc.)
export { useTranslate } from "./hooks";
export { ScreeningResponses } from "./shared";
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
