"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QueryHistoryNavProps {
  historyIndex: number;
  historyLength: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

export function QueryHistoryNav({
  historyIndex,
  historyLength,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  disabled,
}: QueryHistoryNavProps) {
  if (historyLength <= 1) return null;

  return (
    <div className="flex items-center gap-0.5 bg-background rounded px-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onPrevious}
        disabled={!canGoPrevious || disabled}
        className="h-5 w-5"
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>
      <span className="text-[10px] text-muted-foreground tabular-nums px-0.5">
        {historyIndex + 1}/{historyLength}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onNext}
        disabled={!canGoNext || disabled}
        className="h-5 w-5"
      >
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
}
