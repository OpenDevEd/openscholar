"use client";

import { cn } from "@/lib/utils";

/** The filter sidebar's segmented switch: one choice out of a few, always visible. */
export function SegmentedToggle<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-lg bg-segment p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all duration-200",
            value === option.value
              ? "bg-segment-active shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
