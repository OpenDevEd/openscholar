"use client";

/**
 * CountChip — per-history-row paper picker.
 *
 * Mounted on every selected history entry. Opens a popover with:
 *  - a "N available" hint (skeleton while the fresh SWR fetch is in
 *    flight; "(cached)" fallback on error),
 *  - a numeric stepper (− / input / +) with keyboard shortcuts,
 *  - three presets (50 / 100 / Max).
 *
 * Every commit routes through `useBucketStore.updatePaperCount` — the
 * single write path for staged paperCount. The stepper's upper bound is
 * `min(cap, fresh ?? cached ?? defaultCount)` so a plan-imposed cap and
 * a real-world "only 120 papers match" both constrain the user.
 *
 * On fresh resolve, if the staged paperCount exceeds the new ceiling
 * (e.g. user staged at 200 while OpenAlex now returns only 120), the
 * effect clamps down once and never fires again for that value.
 */

import React from "react";
import { ChevronDown, Minus, Plus } from "@/components/icons";
import { useTranslations } from "next-intl";

import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { badgeVariants } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { cn } from "@/lib/utils";
import { useBucketStore } from "@/lib/store/bucket";
import { useHistoryCount } from "@/lib/hooks/use-history-count";
import type { SearchResult } from "@/lib/types";

type CountChipProps = {
  entry: SearchResult;
  bucketKey: string;
  paperCount: number;
  cap: number;
  defaultCount: number;
};

export function CountChip({
  entry,
  bucketKey,
  paperCount,
  cap,
  defaultCount,
}: CountChipProps) {
  const t = useTranslations("extraction.countChip");
  const updatePaperCount = useBucketStore((s) => s.updatePaperCount);
  const { count: freshCount, isLoading, error, refresh } =
    useHistoryCount(entry);

  const cachedCount = entry.count ?? undefined;
  const availableRaw =
    freshCount ??
    (cachedCount !== undefined ? cachedCount : defaultCount);
  const stepperMax = Math.min(
    cap,
    Math.max(0, Math.floor(availableRaw)),
  );
  const capShadowsAvailable = availableRaw > cap;
  const showCachedTag = error !== undefined && freshCount === undefined;

  // Fresh-count clamp: the only place the effect runs is when a fresh
  // number arrives and the staged paperCount exceeds the new ceiling.
  // Guarded on paperCount > clamp so a stable fresh value won't loop.
  React.useEffect(() => {
    if (freshCount === undefined) return;
    const clamp = Math.min(cap, freshCount);
    if (paperCount > clamp) {
      updatePaperCount(bucketKey, clamp, cap);
    }
  }, [bucketKey, cap, freshCount, paperCount, updatePaperCount]);

  const [liveMessage, setLiveMessage] = React.useState("");

  const commit = React.useCallback(
    (raw: number) => {
      const clamped = Math.max(0, Math.min(stepperMax, Math.floor(raw)));
      updatePaperCount(bucketKey, clamped, cap);
      setLiveMessage(t("liveAnnouncement", { count: clamped }));
    },
    [bucketKey, cap, stepperMax, t, updatePaperCount],
  );

  const [inputValue, setInputValue] = React.useState(String(paperCount));
  React.useEffect(() => {
    setInputValue(String(paperCount));
  }, [paperCount]);

  const onInputCommit = React.useCallback(
    (rawValue: string) => {
      const parsed = Number.parseInt(rawValue, 10);
      if (Number.isNaN(parsed)) {
        setInputValue(String(paperCount));
        return;
      }
      commit(parsed);
    },
    [commit, paperCount],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      let next: number | null = null;
      if (e.key === "ArrowUp") next = paperCount + 1;
      else if (e.key === "ArrowDown") next = paperCount - 1;
      else if (e.key === "PageUp") next = paperCount + 10;
      else if (e.key === "PageDown") next = paperCount - 10;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = stepperMax;
      else if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
        return;
      }
      if (next === null) return;
      e.preventDefault();
      commit(next);
    },
    [commit, paperCount, stepperMax],
  );

  const presets: Array<{ label: string; value: number }> = [
    { label: t("presetFifty"), value: 50 },
    { label: t("presetHundred"), value: 100 },
    { label: t("presetMax"), value: stepperMax },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("chipLabel", {
            count: paperCount,
            query: entry.query,
          })}
          className={cn(
            badgeVariants({ variant: "outline" }),
            "cursor-pointer gap-1 select-none hover:bg-accent",
          )}
        >
          <span>{t("papersLabel", { count: paperCount })}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="end">
        <PopoverHeader className="pb-3">
          <PopoverTitle>{t("title")}</PopoverTitle>
        </PopoverHeader>

        <div className="pb-3 text-xs text-muted-foreground">
          {isLoading && freshCount === undefined ? (
            <SkeletonBar className="h-3 w-28" />
          ) : (
            <span>
              {t("available", { count: availableRaw })}
              {showCachedTag && (
                <span className="ml-1 text-destructive/80">
                  ({t("cached")})
                </span>
              )}
              {capShadowsAvailable && (
                <span className="ml-1">— {t("capApplies")}</span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 pb-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={`${t("step")} −1`}
            disabled={paperCount <= 0}
            onClick={() => commit(paperCount - 1)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Input
            type="number"
            value={inputValue}
            min={0}
            max={stepperMax}
            aria-valuemin={0}
            aria-valuemax={stepperMax}
            aria-valuenow={paperCount}
            aria-label={t("step")}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={(e) => onInputCommit(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-9 text-sm text-center"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={`${t("step")} +1`}
            disabled={paperCount >= stepperMax}
            onClick={() => commit(paperCount + 1)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/50 p-0.5 dark:bg-muted/30">
          {presets.map((preset) => {
            const isActive = paperCount === preset.value;
            const disabled = preset.value <= 0 || preset.value > stepperMax;
            return (
              <button
                key={preset.label}
                type="button"
                aria-label={preset.label}
                disabled={disabled}
                onClick={() => commit(preset.value)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {showCachedTag && (
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-destructive/80">{t("refreshError")}</span>
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => {
                void refresh();
              }}
            >
              {t("refresh")}
            </button>
          </div>
        )}

        <span className="sr-only" aria-live="polite">
          {liveMessage}
        </span>
      </PopoverContent>
    </Popover>
  );
}
