"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CITATION_FORMATS, type CitationStyle } from "@/lib/citations/formats";
import {
  loadCitationStyles,
  searchCitationStyles,
} from "@/lib/citations/styles";

function StyleOption({
  style,
  selected,
  active,
  onSelect,
  onFocus,
  id,
  position,
  count,
}: {
  style: CitationStyle;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
  onFocus: () => void;
  id: string;
  position: number;
  count: number;
}) {
  return (
    <button
      type="button"
      role="option"
      id={id}
      aria-selected={selected}
      aria-posinset={position}
      aria-setsize={count}
      tabIndex={-1}
      onPointerMove={onFocus}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={`flex min-h-10 w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm leading-5 text-popover-foreground hover:bg-accent hover:text-accent-foreground ${active ? "bg-accent text-accent-foreground" : ""}`}
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words">
        {style.label}
      </span>
      {selected && <Check className="mt-0.5 size-4 shrink-0" />}
    </button>
  );
}

function StyleMenu({
  selected,
  onSelect,
}: {
  selected: CitationStyle | undefined;
  onSelect: (style: CitationStyle) => void;
}) {
  // TanStack Virtual measures rows outside React; its instance must stay reactive.
  "use no memo";
  const t = useTranslations("citation");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { data, error, isLoading, mutate } = useSWR(
    "citation-styles",
    loadCitationStyles,
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
  const matches = useMemo(
    () => searchCitationStyles(data ?? CITATION_FORMATS, query),
    [data, query],
  );
  const rows = useMemo(() => {
    const entries = matches.map((style, index) => ({ style, index }));
    if (query.trim()) return entries;
    const common = entries.filter((entry) => entry.style.asset === undefined);
    const other = entries.filter((entry) => entry.style.asset !== undefined);
    return [
      { heading: t("commonStyles") },
      ...common,
      ...(other.length ? [{ heading: t("otherStyles") }, ...other] : []),
    ];
  }, [matches, query, t]);
  const activeRow = rows.findIndex(
    (row) => "index" in row && row.index === active,
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => ("heading" in rows[index] ? 32 : 40),
    getItemKey: (index) =>
      "style" in rows[index] ? rows[index].style.id : rows[index].heading,
    overscan: 6,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...(activeRow >= 0 ? [activeRow] : []),
        ]),
      ].sort((a, b) => a - b),
  });
  const move = (index: number) => {
    const next = Math.max(0, Math.min(matches.length - 1, index));
    setActive(next);
    virtualizer.scrollToIndex(
      rows.findIndex((row) => "index" in row && row.index === next),
      { align: "auto" },
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || !matches.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSelect(matches[active]);
    }
  };
  return (
    <>
      <div className="shrink-0 p-2">
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            role="combobox"
            aria-label={t("searchStyles")}
            placeholder={t("searchStyles")}
            aria-expanded
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={
              matches[active] ? `${listId}-${matches[active].id}` : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              virtualizer.scrollToOffset(0);
            }}
            onKeyDown={onKeyDown}
            className="h-9 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </div>
      <div
        ref={scrollRef}
        role="listbox"
        id={listId}
        aria-label={t("style")}
        className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-1"
        style={{
          height: Math.min(352, virtualizer.getTotalSize()),
          maxHeight: "50vh",
        }}
      >
        <div
          role="presentation"
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtual) => {
            const row = rows[virtual.index];
            return (
              <div
                key={virtual.key}
                data-index={virtual.index}
                ref={virtualizer.measureElement}
                role="presentation"
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtual.start}px)` }}
              >
                {"heading" in row ? (
                  <div className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                    {row.heading}
                  </div>
                ) : (
                  <StyleOption
                    style={row.style}
                    selected={selected?.id === row.style.id}
                    active={active === row.index}
                    id={`${listId}-${row.style.id}`}
                    position={row.index + 1}
                    count={matches.length}
                    onFocus={() => setActive(row.index)}
                    onSelect={() => onSelect(row.style)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {isLoading && (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          {t("loadingStyles")}
        </p>
      )}
      {error && (
        <div role="alert" className="px-4 py-3 text-sm">
          <p>{t("stylesFailed")}</p>
          <Button size="sm" variant="ghost" onClick={() => void mutate()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {!isLoading && !error && matches.length === 0 && (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          {t("noStyles")}
        </p>
      )}
    </>
  );
}

export function CitationStylePicker({
  selected,
  onSelect,
}: {
  selected: CitationStyle | undefined;
  onSelect: (style: CitationStyle) => void;
}) {
  const t = useTranslations("citation");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label={
            selected ? `${t("style")}: ${selected.label}` : t("style")
          }
          title={selected?.label ?? t("style")}
          className="min-w-0 flex-1 justify-between gap-2 border bg-background shadow-xs"
        >
          <span className="truncate">{selected?.label ?? t("style")}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-96 flex-col overflow-hidden p-0"
        style={{ maxWidth: "calc(100vw - 2rem)" }}
      >
        {open && (
          <StyleMenu
            selected={selected}
            onSelect={(style) => {
              onSelect(style);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
