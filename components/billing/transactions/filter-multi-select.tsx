"use client";

import { useState } from "react";

import { Check, ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  count: number;
}

interface Props<T extends string> {
  label: string;
  facet: "type" | "creditPool" | "billingType";
  options: ReadonlyArray<FilterOption<T>>;
  value: readonly T[];
  onChange: (next: readonly T[]) => void;
}

export function FilterMultiSelect<T extends string>({
  label,
  facet,
  options,
  value,
  onChange,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = value.length;

  const toggle = (opt: T) => {
    onChange(
      value.includes(opt) ? value.filter((o) => o !== opt) : [...value, opt],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          data-filter-multi-select={facet}
          data-filter-selected={selected}
        >
          {label}
          {selected > 0 && (
            <Badge
              variant="secondary"
              className="h-4 px-1 text-[10px] tabular-nums"
            >
              {selected}
            </Badge>
          )}
          <ChevronDown
            className="size-3 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={label} className="w-60 p-1">
        <ul
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="flex flex-col"
          data-filter-listbox={facet}
        >
          {options.map((opt) => {
            const isSelected = value.includes(opt.value);
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => toggle(opt.value)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggle(opt.value);
                  }
                }}
                data-filter-option={opt.value}
                data-filter-option-selected={isSelected ? "true" : "false"}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-xs",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex size-3 shrink-0 items-center justify-center"
                  >
                    {isSelected && <Check className="size-3" />}
                  </span>
                  <span>{opt.label}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {opt.count}
                </span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
