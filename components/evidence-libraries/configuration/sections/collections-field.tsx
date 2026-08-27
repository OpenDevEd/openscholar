"use client";

import { useAction } from "convex/react";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, use, useId, useRef, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { EmptyList, FieldGroup, ListRow, move, SortableList } from "../fields";
import { StatusChip } from "../status-chip";

export type CollectionEntry = {
  id: string;
  title?: string;
  enabled?: boolean;
  order?: number;
};

/** A collection in the library's database, from any source. */
export type DatabaseCollection = { id: string; title: string; count: number; source: string };

type CataloguePage = {
  reason?: "not-set-up";
  items: { id: string; title: string; count: number; source: string; parentId: string | null }[];
  nextCursor: string | null;
};

type Catalogue =
  | { status: "ready"; items: DatabaseCollection[]; truncated: boolean }
  | { status: "not-set-up" }
  | { status: "failed" };

type ListAction = (args: { libraryId: Id<"evidenceLibraries">; query?: string; cursor?: string }) => Promise<CataloguePage>;

export const COLLECTION_TITLE_MAX = 100;
const MAX_PAGES = 100;

// Renumbers `order` so rows keep the order they are shown in.
export function renumber(entries: readonly CollectionEntry[]): CollectionEntry[] {
  return entries.map((entry, index) => ({ ...entry, order: index }));
}

export function sortedEntries(entries: readonly CollectionEntry[]): CollectionEntry[] {
  return [...entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * The library's collection catalogue, read once per page open and shared
 * with `use()` across renders. The outer key is the action callback, which
 * Convex creates once per mounted section, so Strict Mode's second render
 * reuses the first call; "Try again" replaces the entry.
 */
const catalogues = new WeakMap<ListAction, Map<string, Promise<Catalogue>>>();

function readCatalogue(list: ListAction, libraryId: Id<"evidenceLibraries">, { fresh = false } = {}) {
  let byLibrary = catalogues.get(list);
  if (!byLibrary) {
    byLibrary = new Map();
    catalogues.set(list, byLibrary);
  }
  const cached = byLibrary.get(libraryId);
  if (cached && !fresh) return cached;
  const promise = loadCatalogue(list, libraryId);
  byLibrary.set(libraryId, promise);
  return promise;
}

async function loadCatalogue(list: ListAction, libraryId: Id<"evidenceLibraries">): Promise<Catalogue> {
  try {
    const items: DatabaseCollection[] = [];
    let cursor: string | undefined;
    let truncated = false;
    for (let page = 0; ; page += 1) {
      const result = await list({ libraryId, cursor });
      if (!result || result.reason === "not-set-up") return { status: "not-set-up" };
      for (const item of result.items) items.push({ id: item.id, title: item.title, count: item.count, source: item.source });
      if (!result.nextCursor) break;
      if (page + 1 >= MAX_PAGES) {
        truncated = true;
        break;
      }
      cursor = result.nextCursor;
    }
    return { status: "ready", items, truncated };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Field body for the Collections section: the collections shown on the
 * site, in order, with a title override, and a picker over the library's
 * own catalogue.
 */
export function CollectionsField({
  libraryId,
  value,
  onChange,
}: {
  libraryId: Id<"evidenceLibraries">;
  value: CollectionEntry[];
  onChange: (value: CollectionEntry[]) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.collections");
  const listCollections = useAction(api.zotero.runtimeReadActions.listLibraryCollections) as ListAction;
  const [attempt, setAttempt] = useState(0);
  const promise = readCatalogue(listCollections, libraryId);
  return (
    <Suspense
      fallback={
        <FieldGroup title={t("shownHeading")} hint={t("introHint")}>
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner className="h-4 w-4" />
            {t("loading")}
          </p>
        </FieldGroup>
      }
    >
      <CollectionsBody
        key={attempt}
        promise={promise}
        value={value}
        onChange={onChange}
        onRetry={() => {
          readCatalogue(listCollections, libraryId, { fresh: true });
          setAttempt((n) => n + 1);
        }}
        onServerSearch={async (query) => {
          const found: DatabaseCollection[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 5; page += 1) {
            const result = await listCollections({ libraryId, query, cursor });
            for (const item of result?.items ?? []) {
              found.push({ id: item.id, title: item.title, count: item.count, source: item.source });
            }
            if (!result?.nextCursor) break;
            cursor = result.nextCursor;
          }
          return found;
        }}
      />
    </Suspense>
  );
}

function CollectionsBody({
  promise,
  value,
  onChange,
  onRetry,
  onServerSearch,
}: {
  promise: Promise<Catalogue>;
  value: CollectionEntry[];
  onChange: (value: CollectionEntry[]) => void;
  onRetry: () => void;
  onServerSearch: (query: string) => Promise<DatabaseCollection[]>;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.collections");
  const catalogue = use(promise);
  const database = catalogue.status === "ready" ? catalogue.items : [];
  const byId = new Map(database.map((item) => [item.id, item]));
  const shown = sortedEntries(value);

  function add(items: DatabaseCollection[]) {
    const next = [...shown];
    for (const item of items) {
      if (next.some((entry) => entry.id === item.id)) continue;
      next.push({ id: item.id, enabled: true });
    }
    onChange(renumber(next));
  }

  return (
    <FieldGroup
      title={t("shownHeading")}
      hint={t("introHint")}
      action={
        <CollectionPicker
          database={database}
          truncated={catalogue.status === "ready" && catalogue.truncated}
          disabled={catalogue.status !== "ready" || database.length === 0}
          shownIds={shown.map((entry) => entry.id)}
          onAdd={add}
          onServerSearch={onServerSearch}
        />
      }
    >
      {catalogue.status === "failed" ? (
        <EmptyList>
          <span role="alert">{t("failed")}</span>{" "}
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>
            {t("tryAgain")}
          </Button>
        </EmptyList>
      ) : catalogue.status === "not-set-up" ? (
        <EmptyList>{t("notSetUp")}</EmptyList>
      ) : database.length === 0 && shown.length === 0 ? (
        <EmptyList>{t("noneInDatabase")}</EmptyList>
      ) : shown.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <SortableList
          ids={shown.map((entry) => entry.id)}
          onMove={(from, to) => onChange(renumber(move(shown, from, to)))}
        >
          {shown.map((entry) => (
            <ListRow
              key={entry.id}
              id={entry.id}
              removeLabel={t("remove")}
              onRemove={() => onChange(renumber(shown.filter((row) => row.id !== entry.id)))}
              data-collection-id={entry.id}
            >
              <CollectionRow
                entry={entry}
                source={byId.get(entry.id)}
                onTitle={(title) =>
                  onChange(shown.map((row) => (row.id === entry.id ? { ...row, title: title || undefined } : row)))
                }
              />
            </ListRow>
          ))}
        </SortableList>
      )}
    </FieldGroup>
  );
}

function CollectionRow({
  entry,
  source,
  onTitle,
}: {
  entry: CollectionEntry;
  source: DatabaseCollection | undefined;
  onTitle: (title: string) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.collections");
  const id = useId();
  const sourceTitle = source?.title ?? entry.title ?? entry.id;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{sourceTitle}</span>
        {source ? (
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {t("records", { count: source.count })}
          </span>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <div className="flex min-h-5 items-center">
          <Label htmlFor={`${id}-title`} className="font-normal">
            {t("titleLabel")}
          </Label>
        </div>
        <Input
          id={`${id}-title`}
          className="bg-background"
          maxLength={COLLECTION_TITLE_MAX}
          value={entry.title ?? ""}
          placeholder={sourceTitle}
          onChange={(e) => onTitle(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("titleHint")}</p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

type SortKey = "title" | "source" | "count";
type Sort = { key: SortKey; dir: "asc" | "desc" };

/**
 * Picks collections from the library's database. Search, filter by source,
 * sort, tick many, add them all at once.
 */
function CollectionPicker({
  database,
  truncated,
  disabled,
  shownIds,
  onAdd,
  onServerSearch,
}: {
  database: DatabaseCollection[];
  /** The catalogue stopped at the page limit; not every collection is listed. */
  truncated: boolean;
  disabled: boolean;
  shownIds: string[];
  onAdd: (items: DatabaseCollection[]) => void;
  onServerSearch: (query: string) => Promise<DatabaseCollection[]>;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.collections.picker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [hideShown, setHideShown] = useState(true);
  const [sort, setSort] = useState<Sort>({ key: "title", dir: "asc" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<DatabaseCollection[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const searchRun = useRef(0);

  const sources = [...new Set(database.map((c) => c.source))];
  const q = query.trim().toLowerCase();
  const known = new Set(database.map((c) => c.id));
  const all = [...database, ...extra.filter((c) => !known.has(c.id))];
  const rows = all
    .filter((c) => !source || c.source === source)
    .filter((c) => !hideShown || !shownIds.includes(c.id))
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.source.toLowerCase().includes(q))
    .sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "count") return (a.count - b.count) * dir;
      return a[sort.key].localeCompare(b[sort.key]) * dir;
    });
  const selectable = rows.filter((c) => !shownIds.includes(c.id));
  const allPicked = selectable.length > 0 && selectable.every((c) => picked.has(c.id));

  function toggleSort(key: SortKey) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  }

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setPicked(new Set());
      setQuery("");
      setSource(null);
      setExtra([]);
      setSearchFailed(false);
      setSearching(false);
      searchRun.current += 1;
    }
  }

  function confirm() {
    onAdd(all.filter((c) => picked.has(c.id)));
    reset(false);
  }

  // The catalogue stopped at the page limit, so a local match list is not the
  // whole truth; this asks the library itself for the typed text.
  async function searchWholeLibrary() {
    const run = ++searchRun.current;
    setSearching(true);
    setSearchFailed(false);
    try {
      const found = await onServerSearch(query.trim());
      if (run !== searchRun.current) return;
      setExtra((current) => {
        const seen = new Set(current.map((c) => c.id));
        const merged = [...current];
        for (const item of found) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }
        return merged;
      });
    } catch {
      if (run === searchRun.current) setSearchFailed(true);
    } finally {
      if (run === searchRun.current) setSearching(false);
    }
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sort.key !== k ? (
      <ArrowUpDown className="h-3 w-3 opacity-50" />
    ) : sort.dir === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Plus />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/50 px-5 py-4">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { total: database.length })}
            {truncated ? ` ${t("truncated", { total: database.length })}` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 border-b border-border/50 bg-muted/30 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              aria-label={t("search")}
              placeholder={t("search")}
              className="bg-background pl-8"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button
                type="button"
                aria-label={t("clear")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery("")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {truncated && q ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={searching} onClick={() => void searchWholeLibrary()}>
                {searching ? <Spinner className="h-4 w-4" /> : <Search className="h-3.5 w-3.5" />}
                {t("searchAll")}
              </Button>
              {searchFailed ? (
                <p className="text-xs text-destructive" role="alert">
                  {t("searchAllFailed")}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={source === null} onClick={() => setSource(null)}>
              {t("allSources")}
            </FilterChip>
            {sources.map((s) => (
              <FilterChip key={s} active={source === s} onClick={() => setSource(s)}>
                {s}
              </FilterChip>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={hideShown} onCheckedChange={(v) => setHideShown(v === true)} />
              {t("hideShown")}
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <Table aria-label={t("title")} className="w-full table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={t("selectAll")}
                    checked={allPicked}
                    disabled={selectable.length === 0}
                    onCheckedChange={(v) =>
                      setPicked((p) => {
                        const next = new Set(p);
                        selectable.forEach((c) => (v === true ? next.add(c.id) : next.delete(c.id)));
                        return next;
                      })
                    }
                  />
                </TableHead>
                <SortHead sort={sort} k="title" onClick={() => toggleSort("title")}>
                  {t("colTitle")} <SortIcon k="title" />
                </SortHead>
                <SortHead sort={sort} k="source" onClick={() => toggleSort("source")}>
                  {t("colSource")} <SortIcon k="source" />
                </SortHead>
                <SortHead sort={sort} k="count" onClick={() => toggleSort("count")} className="w-28 text-right">
                  {t("colRecords")} <SortIcon k="count" />
                </SortHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    {t("noMatch")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((c) => {
                  const already = shownIds.includes(c.id);
                  const checked = picked.has(c.id);
                  const toggle = () =>
                    setPicked((p) => {
                      const next = new Set(p);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  return (
                    <TableRow
                      key={c.id}
                      data-collection-id={c.id}
                      data-picked={checked}
                      aria-disabled={already || undefined}
                      className={cn("cursor-pointer", already && "cursor-default opacity-60", checked && "bg-primary/5")}
                      onClick={() => !already && toggle()}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label={c.title} checked={checked} disabled={already} onCheckedChange={toggle} />
                      </TableCell>
                      <TableCell className="min-w-0"><p className="truncate font-medium" title={c.title}>{c.title}</p></TableCell>
                      <TableCell className="min-w-0"><p className="truncate text-muted-foreground" title={c.source}>{c.source}</p></TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{c.count}</TableCell>
                      <TableCell>{already ? <StatusChip tone="neutral">{t("shown")}</StatusChip> : null}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="items-center border-t border-border/50 px-5 py-3 sm:justify-between">
          <span className="text-sm text-muted-foreground" data-picked-count={picked.size}>
            {t("pickedCount", { count: picked.size })}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => reset(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={picked.size === 0} onClick={confirm}>
              <Plus />
              {t("addPicked", { count: picked.size })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "border-primary/40 bg-primary/10 font-medium text-primary"
          : "border-border/50 bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SortHead({
  sort,
  k,
  onClick,
  className,
  children,
}: {
  sort: Sort;
  k: SortKey;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableHead
      className={className}
      aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
      </button>
    </TableHead>
  );
}
