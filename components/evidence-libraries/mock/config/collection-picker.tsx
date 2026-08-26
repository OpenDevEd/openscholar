"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DatabaseCollection } from "@/lib/evidence-libraries/mock/config";
import { StatusChip } from "../library-status-badge";

type SortKey = "title" | "source" | "count";
type Sort = { key: SortKey; dir: "asc" | "desc" };

/**
 * Picks collections from the library's database. Search, filter by source,
 * sort, tick many, add them all at once.
 */
export function CollectionPicker({
  database,
  shownIds,
  onAdd,
}: {
  database: DatabaseCollection[];
  shownIds: string[];
  onAdd: (items: DatabaseCollection[]) => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.collections.picker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [hideShown, setHideShown] = useState(true);
  const [sort, setSort] = useState<Sort>({ key: "title", dir: "asc" });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const sources = [...new Set(database.map((c) => c.source))];
  const q = query.trim().toLowerCase();
  const rows = database
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
    }
  }

  function confirm() {
    onAdd(database.filter((c) => picked.has(c.id)));
    reset(false);
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
        <Button type="button" variant="outline" size="sm" disabled={database.length === 0}>
          <Plus />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/50 px-5 py-4">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { total: database.length })}</DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="space-y-2.5 border-b border-border/50 bg-muted/30 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
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

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
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
                <SortHead onClick={() => toggleSort("title")}>
                  {t("colTitle")} <SortIcon k="title" />
                </SortHead>
                <SortHead onClick={() => toggleSort("source")}>
                  {t("colSource")} <SortIcon k="source" />
                </SortHead>
                <SortHead onClick={() => toggleSort("count")} className="text-right">
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
                  return (
                    <TableRow
                      key={c.id}
                      data-collection-id={c.id}
                      data-picked={checked}
                      aria-disabled={already || undefined}
                      className={cn("cursor-pointer", already && "cursor-default opacity-60", checked && "bg-primary/5")}
                      onClick={() => {
                        if (already) return;
                        setPicked((p) => {
                          const next = new Set(p);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        });
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={c.title}
                          checked={checked}
                          disabled={already}
                          onCheckedChange={(v) =>
                            setPicked((p) => {
                              const next = new Set(p);
                              if (v === true) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">{c.title}</TableCell>
                      <TableCell className="text-muted-foreground">{c.source}</TableCell>
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

function SortHead({ onClick, className, children }: { onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <TableHead className={className}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
      </button>
    </TableHead>
  );
}
