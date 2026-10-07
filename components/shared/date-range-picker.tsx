"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { isSameDay, startOfDay } from "date-fns";
import { motion, useReducedMotion } from "motion/react";
import { SHEET_SPRING } from "@/components/assistant/sheets";
import { useFormatter, useTranslations } from "next-intl";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface DatePreset {
  key: string;
  label: string;
  getRange: () => DateRange;
}

interface DateRangePickerProps {
  value: DateRange | undefined;
  onValueChange: (range: DateRange | undefined) => void;
  presets?: DatePreset[];
  /** When each item the filter narrows happened. Given, each preset shows how many it keeps and a bar for its share. */
  dates?: number[];
  placeholder?: string;
  className?: string;
}

/**
 * Shared date range picker with Calendar popover and optional presets.
 *
 * Uses commit-on-close: selections are held as local temp state while the
 * popover is open, then committed via `onValueChange` when the popover closes.
 * Preset clicks bypass the popover and commit immediately.
 */
export function DateRangePicker({
  value,
  onValueChange,
  presets,
  dates,
  placeholder,
  className,
}: DateRangePickerProps) {
  const tc = useTranslations("common");
  const tf = useTranslations("searchFilters");
  const format = useFormatter();

  const [isOpen, setIsOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange | undefined>(value);

  // Sync temp range with external value when popover is closed
  useEffect(() => {
    if (!isOpen) {
      setTempRange(value);
    }
  }, [isOpen, value]);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setTempRange(value);
    } else {
      onValueChange(tempRange);
    }
    setIsOpen(open);
  };

  const handlePresetClick = (range: DateRange) => {
    onValueChange(range);
    setIsOpen(false);
  };

  // A preset is on while the filter is exactly its range, which ends today.
  const ranges = (presets ?? []).map((preset) => ({ preset, range: preset.getRange() }));
  const activePreset = ranges.find(({ range }) => value?.from && value.to && range.from && range.to && isSameDay(value.from, range.from) && isSameDay(value.to, range.to))?.preset.key ?? null;
  const within = (range: DateRange, at: number) => (!range.from || at >= startOfDay(range.from).getTime()) && (!range.to || at <= range.to.getTime());

  const isActive = Boolean(value?.from || value?.to);

  const label = useMemo(() => {
    if (value?.from && value?.to) {
      return `${format.dateTime(value.from, { year: "numeric", month: "short", day: "numeric" })} → ${format.dateTime(value.to, { year: "numeric", month: "short", day: "numeric" })}`;
    }
    if (value?.from) {
      return `${tc("from")} ${format.dateTime(value.from, { year: "numeric", month: "short", day: "numeric" })}`;
    }
    if (value?.to) {
      return `${tc("to")} ${format.dateTime(value.to, { year: "numeric", month: "short", day: "numeric" })}`;
    }
    return placeholder ?? tf("chooseDateRange");
  }, [value, tc, tf, format, placeholder]);

  return (
    <div className={cn("space-y-3", className)}>
      {ranges.length ? (
        <div role="radiogroup" className="space-y-1">
          {ranges.map(({ preset, range }) => {
            const on = preset.key === activePreset;
            const kept = dates?.filter((at) => within(range, at)).length;
            return (
              <button
                key={preset.key}
                type="button"
                role="radio"
                aria-checked={on}
                // Picking the one that is on clears it.
                onClick={() => (on ? onValueChange(undefined) : handlePresetClick(range))}
                className={cn(
                  "group relative flex h-9 w-full items-center gap-2 overflow-hidden rounded-lg bg-inset px-3 text-left text-sm transition-colors",
                  on ? "text-primary ring-1 ring-primary/40" : "text-foreground hover:bg-muted",
                )}
              >
                {/* How much of what's here the preset keeps. */}
                {kept !== undefined && dates?.length ? (
                  <span
                    aria-hidden
                    className={cn("absolute inset-y-0 left-0 transition-[width,background-color] duration-300 ease-out", on ? "bg-primary/20" : "bg-primary/10 group-hover:bg-primary/15")}
                    style={{ width: `${(kept / dates.length) * 100}%` }}
                  />
                ) : null}
                <span className={cn("relative flex-1 truncate", on && "font-medium")}>{preset.label}</span>
                {on ? <Check className="relative size-3.5" /> : null}
                {kept !== undefined ? <span className={cn("relative tabular-nums", on ? "text-primary" : "text-muted-foreground")}>{kept}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full h-10 justify-start text-left font-normal",
              isActive
                ? "border-sidebar-primary/50"
                : "border-dashed border-muted-foreground/30 dark:border-muted-foreground/20",
            )}
          >
            <span className="truncate text-sm">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={value?.from}
            selected={tempRange}
            onSelect={setTempRange}
            numberOfMonths={2}
            captionLayout="dropdown"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Quick picks as one segmented strip. A raised thumb slides to the pick that matches the
 * filter. Pass `columns` to wrap them into a grid.
 */
export function PresetStrip({ options, active, onPick, columns = options.length }: {
  options: Array<{ key: string; label: string }>;
  active: string | null;
  onPick: (key: string) => void;
  columns?: number;
}) {
  const thumb = useId();
  const reduce = useReducedMotion();
  const round = columns === options.length ? "rounded-full" : "rounded-[0.625rem]";
  return (
    <div
      role="radiogroup"
      className={cn("grid gap-0.5 bg-segment p-0.5", columns === options.length ? "rounded-full" : "rounded-xl")}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const on = option.key === active;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(option.key)}
            className={cn("relative flex h-8 min-w-0 items-center justify-center px-2 text-xs font-medium transition-colors", round, on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {on ? <motion.span layoutId={thumb} aria-hidden className={cn("absolute inset-0 bg-segment-active shadow-sm", round)} transition={reduce ? { duration: 0 } : SHEET_SPRING} /> : null}
            <span className="relative truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
