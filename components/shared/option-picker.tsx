"use client";

import { useDeferredValue, useRef, useState } from "react";
import type React from "react";
import { Check, ChevronDown, Plus, X } from "@/components/icons";
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

/** `group` sorts options under a heading; `detail` is a second, quieter line; `icon` is a sign before the name, such as a flag; `mark` one after it, such as ROR's. */
export type PickerOption = { id: string; name: string; group?: string; detail?: string; icon?: React.ReactNode; mark?: React.ReactNode; /** Shown but not to be picked, such as a result for words since changed. */ disabled?: boolean };

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
  icons,
  after,
  onSearch,
  busy,
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
  /** What each chip shows before its name, as its row does, such as a country's flag. */
  icons?: Record<string, React.ReactNode>;
  /** What each chip shows after its name, such as a link to the record elsewhere. */
  after?: Record<string, React.ReactNode>;
  /** Given when the caller searches; otherwise the list filters itself. */
  onSearch?: (value: string) => void;
  /** The caller's search is under way: its search box says so. */
  busy?: boolean;
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
            <Plus className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label={label} className="@container w-(--radix-popover-trigger-width) p-0" align="start">
          <OptionList
            options={options}
            selected={selected}
            searchPlaceholder={searchPlaceholder}
            emptyText={emptyText}
            onSearch={onSearch}
            busy={busy}
            onToggle={onToggle}
          />
        </PopoverContent>
      </Popover>
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
              {icons?.[id]}
              <TooltipHint label={names[id] ?? id} onlyWhenClipped>
                <span className="truncate">
                  {names[id] ?? id}
                </span>
              </TooltipHint>
              {after?.[id]}
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

/** Words as the search compares them: lower case, and anything between letters, digits and dots a single space. */
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").trim();

/**
 * The options that hold what was typed, best first: an exact id or name, then one that starts with it, then one with a
 * word that does (the line beneath the name included, so a licence's full title finds it by its short name), then the
 * rest, each in list order. One list without headings, since a match ranks across groups.
 */
function ranked(options: readonly PickerOption[], search: string): PickerOption[] {
  const typed = words(search);
  const rank = (option: PickerOption) => {
    const [id, name, detail] = [words(option.id), words(option.name), words(option.detail ?? "")];
    if (id === typed || name === typed) return 0;
    if (id.startsWith(typed) || name.startsWith(typed)) return 1;
    if (` ${name} ${id} ${detail}`.includes(` ${typed}`)) return 2;
    return name.includes(typed) || id.includes(typed) || detail.includes(typed) ? 3 : -1;
  };
  return options
    .map((option) => [option, rank(option)] as const)
    .filter(([, place]) => place >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([option]) => ({ ...option, group: undefined }));
}

/**
 * A searchable single choice in a popover, from the same list as OptionPicker: the trigger names what is picked, and
 * picking another closes it. A value that isn't one of the options still shows, as it is, so nothing saved is hidden.
 * It ranks its own search: cmdk 1.1.1 ranks rows within a group but never reorders the groups, so the best match in a
 * later group would sit below weak ones in the first.
 */
export function OptionSelect({
  id,
  label,
  value,
  options,
  searchPlaceholder,
  emptyText,
  invalid = false,
  disabled = false,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  options: readonly PickerOption[];
  searchPlaceholder: string;
  emptyText: string;
  /** The value isn't one the list allows: the trigger says so. */
  invalid?: boolean;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const picked = options.find((option) => option.id === value);
  return (
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        {/* At large text on a phone the picked name wraps rather than being cut. The query reads the settings column
            around the field's fieldset (a size container inside a fieldset breaks in Chromium): 15.9rem in a community's
            settings and 13.8rem on Reports at normal text on a 320px phone, so normal text is as before. */}
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="h-9 w-full justify-between font-normal aria-invalid:border-destructive max-sm:@max-[13rem]/settings:h-auto max-sm:@max-[13rem]/settings:min-h-9 max-sm:@max-[13rem]/settings:whitespace-normal max-sm:@max-[13rem]/settings:text-left"
        >
          <TooltipHint label={picked?.name ?? value} onlyWhenClipped>
            <span className="min-w-0 truncate max-sm:@max-[13rem]/settings:whitespace-normal max-sm:@max-[13rem]/settings:wrap-break-word">{picked?.name ?? value}</span>
          </TooltipHint>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={label} className="@container w-(--radix-popover-trigger-width) p-0" align="start">
        <OptionList
          options={words(search) ? ranked(options, search) : options}
          selected={[value]}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          onSearch={setSearch}
          onToggle={(picked) => {
            onChange(picked);
            setOpen(false);
            setSearch("");
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** How many options the list opens with; the rest follow without holding up the opening. */
const FIRST_ROWS = 40;

const rowValue = (option: PickerOption) => `${option.name} ${option.id}`;

/** The search box and the rows. It lives inside the popover, so it starts afresh each time that opens. */
function OptionList({ options, selected, searchPlaceholder, emptyText, onSearch, busy, onToggle }: {
  options: readonly PickerOption[];
  selected: readonly string[];
  searchPlaceholder: string;
  emptyText: string;
  onSearch?: (value: string) => void;
  busy?: boolean;
  onToggle: (id: string) => void;
}) {
  // A long list (every country) opens with its first rows, and React adds the rest when it is free.
  // Only the opening is put off: after it, rows change in step with the search, which is what lets
  // the list settle on the first row of each new search.
  const complete = useDeferredValue(true, false);
  const list = useRef<HTMLDivElement>(null);
  // A list the caller searches can change under the highlighted row, as when a record named exactly as typed takes
  // the typed row's place: the first row is then highlighted, so Enter always picks something.
  const [chosen, setChosen] = useState("");
  const values = options.map(rowValue);
  const highlighted = values.some((value) => value.toLowerCase() === chosen.toLowerCase()) ? chosen : (values[0] ?? "");
  return (
    <Command shouldFilter={!onSearch} {...(onSearch && { value: highlighted, onValueChange: setChosen })}>
      <CommandInput
        busy={busy}
        placeholder={searchPlaceholder}
        onValueChange={(text) => {
          onSearch?.(text);
          // A new search is read from its first row. cmdk moves to that row but scrolls to the one it
          // was on before, so the list is put back at the top once it has done so.
          requestAnimationFrame(() => list.current?.scrollTo({ top: 0 }));
        }}
      />
      <CommandList ref={list} grows={!!onSearch}>
        <CommandEmpty>{emptyText}</CommandEmpty>
        <OptionRows options={complete ? options : options.slice(0, FIRST_ROWS)} selected={selected} onToggle={onToggle} />
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
          disabled={option.disabled}
          // The search box keeps the focus, so typing goes on after a click.
          onMouseDown={(event) => event.preventDefault()}
          onSelect={() => onToggle(option.id)}
        >
          <Check className={cn("size-4", selected.includes(option.id) ? "opacity-100" : "opacity-0")} />
          {option.icon}
          {/* Under 12rem, at large text on a phone, a name wraps rather than being cut, so two licences can be told
              apart; the quieter line beneath stays one line, as at normal text. The list is its field's width: 13.5rem
              at normal text on a 320px phone. */}
          <span className="min-w-0 flex-1">
            <TooltipHint label={option.name} onlyWhenClipped>
              <span className="block truncate max-sm:@max-[12rem]:whitespace-normal max-sm:@max-[12rem]:wrap-break-word">
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
          {option.mark}
        </CommandItem>
      ))}
    </CommandGroup>
  ));
}
