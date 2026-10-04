"use client";

import { useDeferredValue, useRef, useState } from "react";
import type React from "react";
import { Check, ChevronDown, X } from "@/components/icons";
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

/** `group` sorts options under a heading; `detail` is a second, quieter line; `icon` is a sign before the name, such as a flag. */
export type PickerOption = { id: string; name: string; group?: string; detail?: string; icon?: React.ReactNode };

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
      <Popover
        modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // The search box empties when it closes; the caller's search has to as well.
          if (!next) onSearch?.("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="h-9 w-full justify-between font-normal"
          >
            <span className={cn("truncate", selected.length === 0 && "text-subtle-foreground")}>
              {selected.length === 0 ? placeholder : selectedText}
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <OptionList
            options={options}
            selected={selected}
            searchPlaceholder={searchPlaceholder}
            emptyText={emptyText}
            onSearch={onSearch}
            onToggle={onToggle}
          />
        </PopoverContent>
      </Popover>
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
              <TooltipHint label={names[id] ?? id} onlyWhenClipped>
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

/** How many options the list opens with; the rest follow without holding up the opening. */
const FIRST_ROWS = 40;

const rowValue = (option: PickerOption) => `${option.name} ${option.id}`;

/** The search box and the rows. It lives inside the popover, so it starts afresh each time that opens. */
function OptionList({ options, selected, searchPlaceholder, emptyText, onSearch, onToggle }: {
  options: readonly PickerOption[];
  selected: readonly string[];
  searchPlaceholder: string;
  emptyText: string;
  onSearch?: (value: string) => void;
  onToggle: (id: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  // The row the keyboard is on, and the search it was reached in.
  const [active, setActive] = useState({ text: "", value: "" });
  // A long list (every country) opens with its first rows, and React adds the rest when it is free.
  const shown = useDeferredValue(options, options.slice(0, FIRST_ROWS));
  // When the caller searches, the rows change after cmdk has picked its current row, so it kept
  // one that was gone: Enter chose nothing, and the list stayed scrolled where it was. Each
  // search starts on its first row instead.
  const first = shown[0] ? rowValue(shown[0]) : "";
  const current = active.text === text && shown.some((option) => rowValue(option) === active.value) ? active.value : first;
  return (
    <Command
      shouldFilter={!onSearch}
      {...(onSearch ? { value: current, onValueChange: (value: string) => setActive({ text, value }) } : {})}
    >
      <CommandInput
        placeholder={searchPlaceholder}
        onValueChange={
          onSearch &&
          ((next) => {
            setText(next);
            onSearch(next);
            list.current?.scrollTo({ top: 0 });
          })
        }
      />
      <CommandList ref={list}>
        <CommandEmpty>{emptyText}</CommandEmpty>
        <OptionRows options={shown} selected={selected} onToggle={onToggle} />
      </CommandList>
    </Command>
  );
}

function OptionRows({ options: shown, selected, onToggle }: {
  options: readonly PickerOption[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  return [...new Set(shown.map((option) => option.group))].map((group) => (
    <CommandGroup key={group ?? ""} heading={group}>
      {shown.filter((option) => option.group === group).map((option) => (
        <CommandItem
          key={option.id}
          value={rowValue(option)}
          // The search box keeps the focus, so typing goes on after a click.
          onMouseDown={(event) => event.preventDefault()}
          onSelect={() => onToggle(option.id)}
        >
          <Check className={cn("size-4", selected.includes(option.id) ? "opacity-100" : "opacity-0")} />
          {option.icon}
          <span className="min-w-0 flex-1">
            <TooltipHint label={option.name} onlyWhenClipped>
              <span className="block truncate">
                {option.name}
              </span>
            </TooltipHint>
            {option.detail ? (
              <TooltipHint label={option.detail} onlyWhenClipped>
                <span className="block truncate text-xs text-muted-foreground">
                  {option.detail}
                </span>
              </TooltipHint>
            ) : null}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  ));
}
