"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ZoomIn, ZoomOut, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PdfPageControls } from "@/components/extraction/pdf-page-controls";

type ScaleMode = "fit-page" | "fit-width" | "custom";

type PdfToolbarProps = {
  currentPage: number;
  numPages: number;
  pageInput: string;
  onPageInputChange: (value: string) => void;
  onPageInputCommit: () => void;
  onPageChange: (page: number) => void;
  scalePercent: number;
  scaleMode: ScaleMode;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetScaleMode: (mode: ScaleMode) => void;
  onResetZoom: () => void;
};

function ToolbarIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function PdfToolbar({
  currentPage,
  numPages,
  pageInput,
  onPageInputChange,
  onPageInputCommit,
  onPageChange,
  scalePercent,
  scaleMode,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onSetScaleMode,
  onResetZoom,
}: PdfToolbarProps) {
  const t = useTranslations();
  return (
    <div className="pdf-viewer-toolbar border-b border-border/70 bg-background/95">
      <div className="flex flex-wrap items-center gap-1 px-1.5 py-1.5">
        <PdfPageControls
          currentPage={currentPage}
          numPages={numPages}
          pageInput={pageInput}
          onPageInputChange={onPageInputChange}
          onPageInputCommit={onPageInputCommit}
          onPageChange={onPageChange}
        />

        <div className="ml-auto flex items-center gap-0.5">
          <ToolbarIconButton label={t('accessibility.zoomOut')} onClick={onZoomOut} disabled={!canZoomOut}>
            <ZoomOut className="size-3.5" />
          </ToolbarIconButton>

          <span className="min-w-8 text-center text-2xs font-medium text-muted-foreground tabular-nums">
            {scalePercent}%
          </span>

          <ToolbarIconButton label={t('accessibility.zoomIn')} onClick={onZoomIn} disabled={!canZoomIn}>
            <ZoomIn className="size-3.5" />
          </ToolbarIconButton>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label={t('accessibility.viewOptions')}>
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => onSetScaleMode("fit-page")}>{t('accessibility.fitPage')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSetScaleMode("fit-width")}>{t('accessibility.fitWidth')}</DropdownMenuItem>
              <DropdownMenuItem onClick={onResetZoom}>{t('accessibility.resetView')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
