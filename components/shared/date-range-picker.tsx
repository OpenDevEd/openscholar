"use client";

import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { useFormatter, useTranslations } from "next-intl";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full h-10 justify-start text-left font-normal",
              isActive
                ? "border-sidebar-primary/50"
                : "border-dashed border-muted-foreground/30",
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

      {presets && presets.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {presets.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handlePresetClick(preset.getRange())}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
