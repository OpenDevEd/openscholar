"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type PdfPageControlsProps = {
  currentPage: number;
  numPages: number;
  pageInput: string;
  onPageInputChange: (value: string) => void;
  onPageInputCommit: () => void;
  onPageChange: (page: number) => void;
};

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
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

export function PdfPageControls({
  currentPage,
  numPages,
  pageInput,
  onPageInputChange,
  onPageInputCommit,
  onPageChange,
}: PdfPageControlsProps) {
  const t = useTranslations();
  const atStart = currentPage <= 1;
  const atEnd = numPages <= 0 || currentPage >= numPages;

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <IconButton
        label={t('common.previousPage')}
        disabled={atStart}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeft className="size-3.5" />
      </IconButton>

      <div className="flex min-w-0 items-center gap-1 px-1">
        <Input
          value={pageInput}
          onChange={(event) => onPageInputChange(event.target.value)}
          onBlur={onPageInputCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onPageInputCommit();
            }
          }}
          inputMode="numeric"
          aria-label={t('accessibility.pageNumberInput')}
          className="h-7 w-10 text-center text-xs"
        />
        <span className="whitespace-nowrap text-2xs text-muted-foreground">/ {Math.max(1, numPages)}</span>
      </div>

      <IconButton
        label={t('common.nextPage')}
        disabled={atEnd}
        onClick={() => onPageChange(currentPage + 1)}
      >
        <ChevronRight className="size-3.5" />
      </IconButton>
    </div>
  );
}
