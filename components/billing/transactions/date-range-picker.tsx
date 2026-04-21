"use client";

import { useEffect, useState } from "react";

import { CalendarIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const PRESETS = ["today", "7d", "30d", "90d", "ytd", "all"] as const;
type Preset = (typeof PRESETS)[number];

interface Props {
  from: Date | null;
  to: Date | null;
  onChange: (range: { from: Date | null; to: Date | null }) => void;
}

export function DateRangePicker({ from, to, onChange }: Props) {
  const t = useTranslations("billingPage.transactions.filters.date");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() =>
    from && to ? { from, to } : undefined,
  );

  useEffect(() => {
    setDraft(from && to ? { from, to } : undefined);
  }, [from, to]);

  const applyPreset = (preset: Preset) => {
    const now = new Date();
    switch (preset) {
      case "today":
        onChange({ from: startOfDay(now), to: now });
        break;
      case "7d":
      case "30d":
      case "90d": {
        const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
        onChange({
          from: startOfDay(new Date(now.getTime() - days * 86_400_000)),
          to: now,
        });
        break;
      }
      case "ytd":
        onChange({ from: new Date(now.getFullYear(), 0, 1), to: now });
        break;
      case "all":
        onChange({ from: null, to: null });
        break;
    }
    setOpen(false);
  };

  const handleSelect = (range: DateRange | undefined) => {
    setDraft(range);
    if (range?.from && range?.to) {
      onChange({ from: range.from, to: range.to });
    }
  };

  const isActive = from !== null && to !== null;
  const triggerLabel =
    from && to
      ? `${format.dateTime(from, { dateStyle: "medium" })} – ${format.dateTime(to, { dateStyle: "medium" })}`
      : t("label");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          data-transactions-date-range
          data-date-active={isActive ? "true" : "false"}
        >
          <CalendarIcon
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div
          className="flex flex-wrap gap-1 pb-2"
          data-transactions-date-presets
        >
          {PRESETS.map((p) => (
            <Button
              key={p}
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => applyPreset(p)}
              data-date-preset={p}
            >
              {t(`presets.${p}`)}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={draft}
          onSelect={handleSelect}
          numberOfMonths={1}
        />
      </PopoverContent>
    </Popover>
  );
}

function startOfDay(d: Date): Date {
  const clone = new Date(d);
  clone.setHours(0, 0, 0, 0);
  return clone;
}
