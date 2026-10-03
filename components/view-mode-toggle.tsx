"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { VIEW_MODE_OPTIONS } from "@/lib/constants/view-modes";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TooltipHint } from "@/components/ui/tooltip";

/** A small group of icon buttons that picks one way to show something. Every view switch uses it. */
export function IconSwitch<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; icon: ComponentType<{ className?: string }>; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-0.5 rounded-md bg-inset p-0.5">
      {options.map(({ value: option, icon: Icon, label: optionLabel }) => (
        <TooltipHint key={option} label={optionLabel}>
          <button
            type="button"
            aria-pressed={value === option}
            aria-label={optionLabel}
            onClick={() => onChange(option)}
            className={cn(
              "flex size-7 items-center justify-center rounded-[5px] transition-colors",
              value === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        </TooltipHint>
      ))}
    </div>
  );
}

/** The one switch between list and grid views, used by every list that offers them. */
export function ViewModeSwitch({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  const t = useTranslations("viewMode");
  const ta = useTranslations("accessibility");
  return (
    <IconSwitch
      label={ta("viewOptions")}
      value={value}
      onChange={onChange}
      options={VIEW_MODE_OPTIONS.map(({ mode, icon, label }) => ({ value: mode, icon, label: t(label) }))}
    />
  );
}
