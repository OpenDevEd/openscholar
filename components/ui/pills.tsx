"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { AppIcon } from "@/components/icons";
import { SHEET_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * One choice out of a few, as a row of small pills with a highlight that slides to the one
 * picked: the look of the filters by person, for a filter with words.
 */
export function Pills<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: Array<{ id: T; label: string; icon?: AppIcon }>; label: string }) {
  const reduce = useReducedMotion();
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-9 max-w-full shrink-0 items-center gap-0.5 rounded-full bg-segment p-0.5">
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.id)}
            className={cn("relative flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {on ? <motion.span layoutId={`pills-${id}`} aria-hidden className="absolute inset-0 rounded-full bg-segment-active shadow-sm" transition={reduce ? { duration: 0 } : SHEET_SPRING} /> : null}
            {option.icon ? <option.icon className="relative size-3.5 shrink-0" /> : null}
            <span className="relative truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
