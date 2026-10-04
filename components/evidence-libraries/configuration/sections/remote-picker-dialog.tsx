"use client";

/**
 * One picker dialog for every long list on the configuration page. The list
 * lives on the server: the dialog asks for one page at a time, sends the
 * typed text to the server, and never downloads a whole catalogue.
 */

import { ArrowDown, ArrowUp, ArrowUpDown, Check, Plus, Search, X } from "@/components/icons";
import { useTranslations } from "next-intl";
import { type ReactNode, type Ref, useImperativeHandle, useRef, useState } from "react";
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
import { TooltipHint } from "@/components/ui/tooltip";
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

export type PickerDirection = "asc" | "desc";

/** A column the server can order by, and the order it starts in. */
export type PickerSort = {
  value: string;
  column: "title" | "meta" | "count";
  direction: PickerDirection;
};

export type PickerSource = (input: {
  query: string;
  cursor: string | null;
  sort: string | null;
  direction: PickerDirection | null;
}) => Promise<PickerPage>;

/** The rows a source is asked for at a time. */
export const PICKER_PAGE_SIZE = 50;
/** How long the dialog waits after a keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 300;
/** The runtime read API refuses a longer search than this. */
const SEARCH_MAX = 200;

type Status = "loading" | "loading-more" | "ready" | "failed" | "not-set-up";

/** Opens the dialog from elsewhere, such as a menu item that also opens other dialogs. */
export type PickerHandle = { open: () => void };

type CommonProps = {
  /** The control that opens the dialog. Keeps each call site's own look. */
  trigger?: ReactNode;
  ref?: Ref<PickerHandle>;
  title: string;
  description: ReactNode;
  searchLabel: string;
  columns: { title: string; meta?: string; count?: string };
  /** Offered as sortable column headers; the value goes to the server. */
  sorts?: readonly PickerSort[];
  source: PickerSource;
  /** Optional visual shown before a loaded row's title. */
  renderLeading?: (row: PickerRow) => ReactNode;
  /** Extra controls under the search box, given the rows loaded so far. */
  controls?: (rows: PickerRow[]) => ReactNode;
  /** Hides rows of the loaded page; for chips and "hide already shown". */
  rowFilter?: (row: PickerRow) => boolean;
  /** Rows already in use: they cannot be picked and carry `usedLabel`. */
  usedIds?: readonly string[];
  usedLabel?: string;
  /** What this list says while it loads, and when it cannot be read. */
  loadingLabel: string;
  failedLabel: string;
  /** Nothing in the list at all. */
  emptyLabel: string;
  /** Nothing matches the typed text or the chosen filter. */
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
    renderLeading,
    controls,
    rowFilter,
    usedIds,
    usedLabel,
    loadingLabel,
    failedLabel,
    emptyLabel,
    noMatchLabel,
    notSetUpLabel,
    onRowsLoaded,
    onOpenChange,
    note,
    ref,
  } = props;
  const t = useTranslations("evidenceLibraryConfiguration.picker");
  const firstSort = sorts?.[0] ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ value: string; direction: PickerDirection } | null>(
    firstSort ? { value: firstSort.value, direction: firstSort.direction } : null,
  );
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  // Ticked rows are kept whole, so a later search or filter cannot lose a
  // choice the owner already made.
  const [picked, setPicked] = useState<Map<string, PickerRow>>(new Map());
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  // Browser timer: the server is asked once typing stops, not per keystroke.
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const body = useRef<HTMLDivElement | null>(null);

  const used = new Set(usedIds ?? []);
  const ready = status === "ready" || status === "loading-more";
  const visible = ready ? (rowFilter ? rows.filter(rowFilter) : rows) : [];
  const selectable = visible.filter((row) => !used.has(row.id));
  const allPicked = selectable.length > 0 && selectable.every((row) => picked.has(row.id));
  const typed = query.trim();
  // A typed name is offered once the server answered that very text with
  // nothing, and whenever the library cannot be read at all.
  const typedIsNew =
    props.mode === "single" &&
    props.newLabel !== undefined &&
    typed.length > 0 &&
    (status === "failed" || status === "not-set-up" || (status === "ready" && rows.length === 0));

  function load(next: {
    query: string;
    sort: string | null;
    direction: PickerDirection | null;
    cursor: string | null;
  }) {
    const id = ++run.current;
    setStatus(next.cursor ? "loading-more" : "loading");
    if (!next.cursor) {
      setRows([]);
      setCursor(null);
    }
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
    const start = firstSort ? { value: firstSort.value, direction: firstSort.direction } : null;
    setSort(start);
    if (!nextOpen) {
      run.current += 1;
      return;
    }
    load({ query: "", sort: start?.value ?? null, direction: start?.direction ?? null, cursor: null });
  }

  useImperativeHandle(ref, () => ({ open: () => reset(true) }));

  function search(value: string) {
    setQuery(value);
    clearTimeout(debounce.current);
    // The answer to the old text is dropped at once, so a slow page can
    // never land under new text, and "Load more" cannot mix the two.
    run.current += 1;
    setRows([]);
    setCursor(null);
    setStatus("loading");
    debounce.current = setTimeout(
      () =>
        load({
          query: value.trim(),
          sort: sort?.value ?? null,
          direction: sort?.direction ?? null,
          cursor: null,
        }),
      SEARCH_DEBOUNCE_MS,
    );
  }

  function sortBy(column: PickerSort) {
    const next: { value: string; direction: PickerDirection } =
      sort?.value === column.value
        ? { value: column.value, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { value: column.value, direction: column.direction };
    setSort(next);
    clearTimeout(debounce.current);
    load({ query: typed, sort: next.value, direction: next.direction, cursor: null });
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
      setPicked(
        (current) =>
          new Map(
            failed.flatMap((id) => {
              const row = current.get(id);
              return row ? [[id, row] as const] : [];
            }),
          ),
      );
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
  const emptyMessage = typed || rows.length > 0 ? noMatchLabel : emptyLabel;

  return (
    <Dialog open={open} onOpenChange={reset}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl"
        onKeyDown={moveFocus}
      >
        <DialogHeader className="border-b border-border-subtle px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 border-b border-border-subtle bg-inset px-5 py-3">
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
              {/* "None" and the typed name are the owner's own choices, so
                  they stay offered even when the library cannot be read. */}
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

              {status === "loading" ? (
                <MessageRow columnCount={columnCount}>
                  <span className="flex items-center justify-center gap-2" role="status">
                    <Spinner className="h-4 w-4" />
                    {loadingLabel}
                  </span>
                </MessageRow>
              ) : status === "failed" ? (
                <MessageRow columnCount={columnCount}>
                  <span role="alert">
                    <span className="text-destructive">{failedLabel}</span>{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() =>
                        load({
                          query: typed,
                          sort: sort?.value ?? null,
                          direction: sort?.direction ?? null,
                          cursor: null,
                        })
                      }
                    >
                      {t("tryAgain")}
                    </Button>
                  </span>
                </MessageRow>
              ) : status === "not-set-up" ? (
                <MessageRow columnCount={columnCount}>
                  <span data-picker-state="not-set-up">{notSetUpLabel}</span>
                </MessageRow>
              ) : visible.length === 0 ? (
                <MessageRow columnCount={columnCount}>{emptyMessage}</MessageRow>
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
                          <Check className={chosen ? "h-4 w-4" : "h-4 w-4 opacity-0"} aria-hidden />
                        )}
                      </TableCell>
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-center gap-3">
                          {renderLeading ? (
                            <span className="shrink-0 text-muted-foreground">
                              {renderLeading(row)}
                            </span>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <TooltipHint label={row.title} onlyWhenClipped>
                              <p className="truncate font-medium">{row.title}</p>
                            </TooltipHint>
                            {row.detail}
                          </div>
                        </div>
                      </TableCell>
                      {columns.meta ? (
                        <TableCell className="min-w-0">
                          <TooltipHint label={row.meta} onlyWhenClipped>
                            <p className="truncate text-muted-foreground">{row.meta}</p>
                          </TooltipHint>
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
          {ready && cursor ? (
            <div className="flex justify-center border-t border-border-subtle py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={status === "loading-more"}
                onClick={() =>
                  load({
                    query: typed,
                    sort: sort?.value ?? null,
                    direction: sort?.direction ?? null,
                    cursor,
                  })
                }
              >
                {status === "loading-more" ? <Spinner className="h-4 w-4" /> : null}
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
          {note ? (
            <p className="border-t border-border-subtle px-5 py-3 text-xs text-muted-foreground">
              {note}
            </p>
          ) : null}
        </div>

        <DialogFooter className="items-center border-t border-border-subtle px-5 py-3 sm:justify-between">
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
                {busy ? <Spinner className="h-4 w-4" /> : <Plus />}
                {props.confirmLabel(picked.size)}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One line across the table: loading, a failure, or nothing to show. */
function MessageRow({ columnCount, children }: { columnCount: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount + 1} className="py-10 text-center text-sm text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
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
  active: { value: string; direction: PickerDirection } | null;
  onSort: (sort: PickerSort) => void;
  className?: string;
  children: ReactNode;
}) {
  if (!sort) return <TableHead className={className}>{children}</TableHead>;
  const on = active?.value === sort.value;
  return (
    <TableHead
      className={className}
      aria-sort={on ? (active.direction === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {children}
        {!on ? (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        ) : active.direction === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )}
      </button>
    </TableHead>
  );
}

/** Pages an in-memory list the same way a server source does. */
export function localPickerSource(rows: readonly PickerRow[], pageSize = PICKER_PAGE_SIZE): PickerSource {
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
