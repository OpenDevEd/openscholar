"use client";

/**
 * One picker dialog for every long list on the configuration page. The list
 * lives on the server: the dialog asks for one page at a time, sends the
 * typed text to the server, and never downloads a whole catalogue.
 */

import { ArrowDown, ArrowUp, Check, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { StatusChip } from "../status-chip";

/** One row in a picker: what the owner reads before choosing. */
export type PickerRow = {
  id: string;
  title: string;
  meta?: string;
  count?: number;
  /** Extra facts under the title, such as a group's visibility and id. */
  detail?: ReactNode;
};

export type PickerPage = {
  items: PickerRow[];
  nextCursor: string | null;
  /** The library has no running runtime yet, so it has nothing to list. */
  reason?: "not-set-up";
};

/** A column the server can order by, and the order it uses. */
export type PickerSort = {
  value: string;
  column: "title" | "meta" | "count";
  direction: "ascending" | "descending";
};

export type PickerSource = (input: {
  query: string;
  cursor: string | null;
  sort: string | null;
}) => Promise<PickerPage>;

/** How long the dialog waits after a keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 300;
/** The runtime read API refuses a longer search than this. */
const SEARCH_MAX = 200;

type Status = "loading" | "loading-more" | "ready" | "failed" | "not-set-up";

type CommonProps = {
  /** The control that opens the dialog. Keeps each call site's own look. */
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  searchLabel: string;
  columns: { title: string; meta?: string; count?: string };
  /** Offered as sortable column headers; the value goes to the server. */
  sorts?: readonly PickerSort[];
  source: PickerSource;
  /** Extra controls under the search box, given the rows loaded so far. */
  controls?: (rows: PickerRow[]) => ReactNode;
  /** Hides rows of the loaded page; for chips and "hide already shown". */
  rowFilter?: (row: PickerRow) => boolean;
  /** Rows already in use: they cannot be picked and carry `usedLabel`. */
  usedIds?: readonly string[];
  usedLabel?: string;
  /** Nothing in the list at all. */
  emptyLabel: string;
  /** Nothing matches the typed text. */
  noMatchLabel: string;
  notSetUpLabel: string;
  /** Called with each page of rows as it arrives. */
  onRowsLoaded?: (rows: PickerRow[]) => void;
  onOpenChange?: (open: boolean) => void;
  /** A note above the footer, such as a list the source itself cuts short. */
  note?: ReactNode;
};

type MultiProps = CommonProps & {
  mode: "multi";
  confirmLabel: (count: number) => string;
  /** Returns the ids it could not use, so they stay ticked. */
  onConfirm: (rows: PickerRow[]) => void | Promise<readonly string[] | void>;
};

type SingleProps = CommonProps & {
  mode: "single";
  /** The chosen id, marked in the list. */
  value: string;
  onChoose: (row: PickerRow | null) => void;
  /** Offers a row that clears the value. */
  noneLabel?: string;
  /** Offers a row that uses the typed text when nothing matches it. */
  newLabel?: (typed: string) => string;
};

export function RemotePickerDialog(props: MultiProps | SingleProps) {
  const {
    trigger,
    title,
    description,
    searchLabel,
    columns,
    sorts,
    source,
    controls,
    rowFilter,
    usedIds,
    usedLabel,
    emptyLabel,
    noMatchLabel,
    notSetUpLabel,
    onRowsLoaded,
    onOpenChange,
    note,
  } = props;
  const t = useTranslations("evidenceLibraryConfiguration.picker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<string | null>(sorts?.[0]?.value ?? null);
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  // Ticked rows are kept whole, so a later search or filter cannot drop a
  // choice the owner already made.
  const [picked, setPicked] = useState<Map<string, PickerRow>>(new Map());
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  // Browser timer: the server is asked once typing stops, not per keystroke.
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const body = useRef<HTMLDivElement | null>(null);

  const used = new Set(usedIds ?? []);
  const visible = rowFilter ? rows.filter(rowFilter) : rows;
  const selectable = visible.filter((row) => !used.has(row.id));
  const allPicked = selectable.length > 0 && selectable.every((row) => picked.has(row.id));
  const typed = query.trim();
  const typedIsNew =
    props.mode === "single" &&
    props.newLabel !== undefined &&
    typed.length > 0 &&
    !rows.some((row) => row.title.toLowerCase() === typed.toLowerCase());

  function load(next: { query: string; sort: string | null; cursor: string | null }) {
    const id = ++run.current;
    setStatus(next.cursor ? "loading-more" : "loading");
    if (!next.cursor) setRows([]);
    source(next)
      .then((page) => {
        if (id !== run.current) return;
        if (page.reason === "not-set-up") {
          setRows([]);
          setCursor(null);
          setStatus("not-set-up");
          return;
        }
        setRows((current) => (next.cursor ? [...current, ...page.items] : page.items));
        onRowsLoaded?.(page.items);
        setCursor(page.nextCursor);
        setStatus("ready");
      })
      .catch(() => {
        if (id === run.current) setStatus("failed");
      });
  }

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
    clearTimeout(debounce.current);
    setQuery("");
    setPicked(new Map());
    setBusy(false);
    const firstSort = sorts?.[0]?.value ?? null;
    setSort(firstSort);
    if (!nextOpen) {
      run.current += 1;
      return;
    }
    load({ query: "", sort: firstSort, cursor: null });
  }

  function search(value: string) {
    setQuery(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(
      () => load({ query: value.trim(), sort, cursor: null }),
      SEARCH_DEBOUNCE_MS,
    );
  }

  function sortBy(value: string) {
    setSort(value);
    clearTimeout(debounce.current);
    load({ query: typed, sort: value, cursor: null });
  }

  function toggle(row: PickerRow) {
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }

  function choose(row: PickerRow | null) {
    if (props.mode !== "single") return;
    props.onChoose(row);
    reset(false);
  }

  async function confirm() {
    if (props.mode !== "multi") return;
    setBusy(true);
    let failed: readonly string[] | void;
    try {
      failed = await props.onConfirm([...picked.values()]);
    } finally {
      setBusy(false);
    }
    if (failed && failed.length > 0) {
      setPicked((current) => new Map(failed.flatMap((id) => {
        const row = current.get(id);
        return row ? [[id, row] as const] : [];
      })));
      return;
    }
    reset(false);
  }

  // Up and down move between rows, the way a list is expected to behave.
  function moveFocus(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(body.current?.querySelectorAll<HTMLElement>("[data-picker-row]") ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const active = items.findIndex((item) => item.contains(document.activeElement));
    const next =
      active < 0
        ? 0
        : event.key === "ArrowDown"
          ? Math.min(active + 1, items.length - 1)
          : Math.max(active - 1, 0);
    items[next]?.focus();
  }

  const columnCount = 2 + (columns.meta ? 1 : 0) + (columns.count ? 1 : 0);
  const sortFor = (column: PickerSort["column"]) => sorts?.find((one) => one.column === column);

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl"
        onKeyDown={moveFocus}
      >
        <DialogHeader className="border-b border-border/50 px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 border-b border-border/50 bg-muted/30 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              maxLength={SEARCH_MAX}
              aria-label={searchLabel}
              placeholder={searchLabel}
              className="bg-background pl-8"
              onChange={(event) => search(event.target.value)}
            />
            {query ? (
              <button
                type="button"
                aria-label={t("clear")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => search("")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {controls ? <div className="flex flex-wrap items-center gap-1.5">{controls(rows)}</div> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto" ref={body}>
          {status === "loading" ? (
            <p className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground" role="status">
              <Spinner className="h-4 w-4" />
              {t("loading")}
            </p>
          ) : status === "failed" ? (
            <p className="px-5 py-10 text-sm" role="alert">
              <span className="text-destructive">{t("failed")}</span>{" "}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => load({ query: typed, sort, cursor: null })}
              >
                {t("tryAgain")}
              </Button>
            </p>
          ) : status === "not-set-up" ? (
            <p className="px-5 py-10 text-sm text-muted-foreground" data-picker-state="not-set-up">
              {notSetUpLabel}
            </p>
          ) : (
            <>
              <Table aria-label={title} className="w-full table-fixed">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-10">
                      {props.mode === "multi" ? (
                        <Checkbox
                          aria-label={t("selectAll")}
                          checked={allPicked}
                          disabled={selectable.length === 0}
                          onCheckedChange={(value) =>
                            setPicked((current) => {
                              const next = new Map(current);
                              for (const row of selectable) {
                                if (value === true) next.set(row.id, row);
                                else next.delete(row.id);
                              }
                              return next;
                            })
                          }
                        />
                      ) : null}
                    </TableHead>
                    <SortHead sort={sortFor("title")} active={sort} onSort={sortBy}>
                      {columns.title}
                    </SortHead>
                    {columns.meta ? (
                      <SortHead sort={sortFor("meta")} active={sort} onSort={sortBy}>
                        {columns.meta}
                      </SortHead>
                    ) : null}
                    {columns.count ? (
                      <SortHead
                        sort={sortFor("count")}
                        active={sort}
                        onSort={sortBy}
                        className="w-28 text-right"
                      >
                        {columns.count}
                      </SortHead>
                    ) : null}
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {props.mode === "single" && props.noneLabel ? (
                    <ChoiceRow
                      columnCount={columnCount}
                      chosen={props.value === ""}
                      label={props.noneLabel}
                      onChoose={() => choose(null)}
                    />
                  ) : null}
                  {typedIsNew && props.mode === "single" && props.newLabel ? (
                    <ChoiceRow
                      columnCount={columnCount}
                      chosen={false}
                      label={props.newLabel(typed)}
                      onChoose={() => choose({ id: typed, title: typed })}
                    />
                  ) : null}
                  {visible.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={columnCount + 1}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {typed ? noMatchLabel : emptyLabel}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((row) => {
                      const already = used.has(row.id);
                      const checked = picked.has(row.id);
                      const chosen = props.mode === "single" && props.value === row.id;
                      const act = () => {
                        if (already) return;
                        if (props.mode === "single") choose(row);
                        else toggle(row);
                      };
                      return (
                        <TableRow
                          key={row.id}
                          data-picker-row
                          data-picker-id={row.id}
                          data-picked={props.mode === "multi" ? checked : chosen}
                          tabIndex={-1}
                          aria-disabled={already || undefined}
                          className={cn(
                            "cursor-pointer",
                            already && "cursor-default opacity-60",
                            (checked || chosen) && "bg-primary/5",
                          )}
                          onClick={act}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            act();
                          }}
                        >
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            {props.mode === "multi" ? (
                              <Checkbox
                                aria-label={row.title}
                                checked={checked}
                                disabled={already}
                                onCheckedChange={act}
                              />
                            ) : (
                              <Check
                                className={chosen ? "h-4 w-4" : "h-4 w-4 opacity-0"}
                                aria-hidden
                              />
                            )}
                          </TableCell>
                          <TableCell className="min-w-0">
                            <p className="truncate font-medium" title={row.title}>
                              {row.title}
                            </p>
                            {row.detail}
                          </TableCell>
                          {columns.meta ? (
                            <TableCell className="min-w-0">
                              <p className="truncate text-muted-foreground" title={row.meta}>
                                {row.meta}
                              </p>
                            </TableCell>
                          ) : null}
                          {columns.count ? (
                            <TableCell className="text-right font-mono text-xs tabular-nums">
                              {row.count}
                            </TableCell>
                          ) : null}
                          <TableCell>
                            {already && usedLabel ? (
                              <StatusChip tone="neutral">{usedLabel}</StatusChip>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              {cursor ? (
                <div className="flex justify-center border-t border-border/50 py-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={status === "loading-more"}
                    onClick={() => load({ query: typed, sort, cursor })}
                  >
                    {status === "loading-more" ? <Spinner className="h-4 w-4" /> : null}
                    {t("loadMore")}
                  </Button>
                </div>
              ) : null}
              {note ? (
                <p className="border-t border-border/50 px-5 py-3 text-xs text-muted-foreground">
                  {note}
                </p>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="items-center border-t border-border/50 px-5 py-3 sm:justify-between">
          {props.mode === "multi" ? (
            <span className="text-sm text-muted-foreground" data-picked-count={picked.size}>
              {t("pickedCount", { count: picked.size })}
            </span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => reset(false)}>
              {t("cancel")}
            </Button>
            {props.mode === "multi" ? (
              <Button type="button" disabled={picked.size === 0 || busy} onClick={() => void confirm()}>
                {busy ? <Spinner className="h-4 w-4" /> : null}
                {props.confirmLabel(picked.size)}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The "None" and "use what I typed" rows, above the list. */
function ChoiceRow({
  columnCount,
  chosen,
  label,
  onChoose,
}: {
  columnCount: number;
  chosen: boolean;
  label: string;
  onChoose: () => void;
}) {
  return (
    <TableRow
      data-picker-row
      tabIndex={-1}
      className={cn("cursor-pointer", chosen && "bg-primary/5")}
      onClick={onChoose}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onChoose();
      }}
    >
      <TableCell>
        <Check className={chosen ? "h-4 w-4" : "h-4 w-4 opacity-0"} aria-hidden />
      </TableCell>
      <TableCell colSpan={columnCount} className="font-medium">
        {label}
      </TableCell>
    </TableRow>
  );
}

function SortHead({
  sort,
  active,
  onSort,
  className,
  children,
}: {
  sort: PickerSort | undefined;
  active: string | null;
  onSort: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  if (!sort) return <TableHead className={className}>{children}</TableHead>;
  const on = sort.value === active;
  return (
    <TableHead className={className} aria-sort={on ? sort.direction : undefined}>
      <button
        type="button"
        onClick={() => onSort(sort.value)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {children}
        {sort.direction === "ascending" ? (
          <ArrowUp className={on ? "h-3 w-3" : "h-3 w-3 opacity-50"} />
        ) : (
          <ArrowDown className={on ? "h-3 w-3" : "h-3 w-3 opacity-50"} />
        )}
      </button>
    </TableHead>
  );
}

/** Pages an in-memory list the same way a server source does. */
export function localPickerSource(
  rows: readonly PickerRow[],
  pageSize = 50,
): PickerSource {
  return async ({ query, cursor }) => {
    const text = query.trim().toLowerCase();
    const matching = text
      ? rows.filter(
          (row) =>
            row.title.toLowerCase().includes(text) ||
            (row.meta ?? "").toLowerCase().includes(text) ||
            row.id.toLowerCase().includes(text),
        )
      : [...rows];
    const from = cursor ? Number(cursor) : 0;
    const page = matching.slice(from, from + pageSize);
    return {
      items: page,
      nextCursor: from + pageSize < matching.length ? String(from + pageSize) : null,
    };
  };
}
