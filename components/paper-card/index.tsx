"use client";
import { PaperCardListDetail } from "./paper-card-list-detail";
import { PaperCardListSimple } from "./paper-card-list-simple";
import { PaperCardGrid } from "./paper-card-grid";
import type { PaperCardProps } from "./shared";
import type { ViewMode } from "@/lib/types";

// Re-export for consumers (focus-mode, etc.)
export { useTranslate } from "./hooks";
export { ScreeningResponses } from "./shared";

interface PaperCardWithModeProps extends PaperCardProps {
  viewMode?: ViewMode;
}

export function PaperCard({
  result,
  resultIndex,
  onDownloadItem,
  onDownloadEssentialItem,
  viewMode = "list-detail",
  hide,
  extra,
}: PaperCardWithModeProps) {
  switch (viewMode) {
    case "list-simple":
      return (
        <PaperCardListSimple
          result={result}
          resultIndex={resultIndex}
          onDownloadItem={onDownloadItem}
          onDownloadEssentialItem={onDownloadEssentialItem}
          hide={hide}
          extra={extra}
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
          hide={hide}
          viewMode={viewMode}
          extra={extra}
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
          hide={hide}
          extra={extra}
        />
      );
  }
}
