"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** `group` sorts options under a heading; `detail` is a second, quieter line. */
export type PickerOption = { id: string; name: string; group?: string; detail?: string };

/** A searchable multi-select in a popover, with the choices as removable chips below. */
export function OptionPicker({
  label,
  placeholder,
  selectedText,
  searchPlaceholder,
  emptyText,
  removeLabel,
  options,
  selected,
  names,
  onSearch,
  onToggle,
}: {
  label: string;
  placeholder: string;
  selectedText: string;
  searchPlaceholder: string;
  emptyText: string;
  removeLabel: (name: string) => string;
  options: readonly PickerOption[];
  selected: readonly string[];
  names: Record<string, string>;
  /** Given when the caller searches; otherwise the list filters itself. */
  onSearch?: (value: string) => void;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      {/* Modal gives the list its own scroll lock; a dialog's blocks the wheel otherwise. */}
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="h-9 w-full justify-between font-normal"
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {selected.length === 0 ? placeholder : selectedText}
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-96 p-0" align="start">
          <Command shouldFilter={!onSearch}>
            <CommandInput placeholder={searchPlaceholder} onValueChange={onSearch} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              {[...new Set(options.map((option) => option.group))].map((group) => (
                <CommandGroup key={group ?? ""} heading={group}>
                  {options.filter((option) => option.group === group).map((option) => (
                    <CommandItem
                      key={option.id}
                      value={`${option.name} ${option.id}`}
                      onSelect={() => onToggle(option.id)}
                    >
                      <Check className={cn("size-4", selected.includes(option.id) ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1">
                        <TooltipHint label={option.name}>
                          <span className="block truncate">
                            {option.name}
                          </span>
                        </TooltipHint>
                        {option.detail ? (
                          <TooltipHint label={option.detail}>
                            <span className="block truncate text-xs text-muted-foreground">
                              {option.detail}
                            </span>
                          </TooltipHint>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
              <TooltipHint label={names[id] ?? id}>
                <span className="truncate">
                  {names[id] ?? id}
                </span>
              </TooltipHint>
              <button
                type="button"
                aria-label={removeLabel(names[id] ?? id)}
                className="rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => onToggle(id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
