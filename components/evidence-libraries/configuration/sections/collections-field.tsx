"use client";

import { useAction } from "convex/react";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type CollectionEntry = {
  id: string;
  title?: string;
  enabled?: boolean;
  order?: number;
};

type RuntimeCollection = { id: string; title: string; count: number; source: string; parentId: string | null };

type PickerState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "not-set-up" }
  | { status: "ready"; items: RuntimeCollection[]; nextCursor: string | null; loadingMore: boolean };

export const COLLECTION_TITLE_MAX = 100;

// Renumbers `order` so rows keep the order they are shown in.
export function renumber(entries: readonly CollectionEntry[]): CollectionEntry[] {
  return entries.map((entry, index) => ({ ...entry, order: index }));
}

export function sortedEntries(entries: readonly CollectionEntry[]): CollectionEntry[] {
  return [...entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Field body for the Collections section: the chosen collections in order
 * with a title override, plus a picker fed by the library's own catalogue.
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
  const t = useTranslations("evidenceLibraryCollections");
  const listCollections = useAction(api.zotero.runtimeReadActions.listLibraryCollections);
  const [picker, setPicker] = useState<PickerState>({ status: "closed" });
  const [query, setQuery] = useState("");
  const requestCount = useRef(0);
  const searchId = useId();
  const entries = sortedEntries(value);
  const chosen = new Set(entries.map((entry) => entry.id));

  async function search(nextQuery: string, cursor?: string) {
    const request = ++requestCount.current;
    setPicker((state) =>
      cursor && state.status === "ready" ? { ...state, loadingMore: true } : { status: "loading" },
    );
    try {
      const page = await listCollections({ libraryId, query: nextQuery || undefined, cursor });
      if (request !== requestCount.current) return;
      if (page.reason === "not-set-up") {
        setPicker({ status: "not-set-up" });
        return;
      }
      setPicker((state) => ({
        status: "ready",
        items: cursor && state.status === "ready" ? [...state.items, ...page.items] : page.items,
        nextCursor: page.nextCursor,
        loadingMore: false,
      }));
    } catch {
      if (request === requestCount.current) setPicker({ status: "failed" });
    }
  }

  function openPicker() {
    setQuery("");
    void search("");
  }

  function add(item: RuntimeCollection) {
    onChange(renumber([...entries, { id: item.id, title: item.title, enabled: true }]));
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...entries];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(renumber(next));
  }

  function patch(id: string, update: Partial<CollectionEntry>) {
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...update } : entry)));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={openPicker}>
          <Plus className="h-3.5 w-3.5" />
          {t("add")}
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          {t("emptyList")}
        </p>
      ) : (
        <ol className="space-y-2" aria-label={t("listLabel")}>
          {entries.map((entry, index) => {
            const titleId = `${searchId}-title-${entry.id}`;
            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 p-3"
                data-collection-id={entry.id}
              >
                <div className="flex flex-col">
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label={t("moveDown")} disabled={index === entries.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor={titleId} className="text-xs text-muted-foreground">
                    {t("titleLabel")} <span className="font-mono">{entry.id}</span>
                  </Label>
                  <Input
                    id={titleId}
                    className="bg-background"
                    maxLength={COLLECTION_TITLE_MAX}
                    value={entry.title ?? ""}
                    onChange={(event) =>
                      patch(entry.id, { title: event.target.value || undefined })
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`${titleId}-shown`} className="text-xs">{t("shown")}</Label>
                  <Switch
                    id={`${titleId}-shown`}
                    checked={entry.enabled !== false}
                    onCheckedChange={(checked) => patch(entry.id, { enabled: checked })}
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("remove")} onClick={() => onChange(renumber(entries.filter((row) => row.id !== entry.id)))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={picker.status !== "closed"} onOpenChange={(open) => !open && setPicker({ status: "closed" })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pickerTitle")}</DialogTitle>
            <DialogDescription>{t("pickerDescription")}</DialogDescription>
          </DialogHeader>
          {picker.status === "not-set-up" ? (
            <p className="text-sm text-muted-foreground" data-picker-state="not-set-up">{t("notSetUp")}</p>
          ) : (
            <>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void search(query);
                }}
              >
                <Label htmlFor={searchId} className="sr-only">{t("search")}</Label>
                <Input
                  id={searchId}
                  className="bg-background"
                  placeholder={t("searchPlaceholder")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button type="submit" variant="outline" size="icon" aria-label={t("search")}>
                  <Search className="h-4 w-4" />
                </Button>
              </form>
              {picker.status === "loading" ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Spinner className="h-4 w-4" />
                  {t("loading")}
                </p>
              ) : picker.status === "failed" ? (
                <p className="text-sm text-destructive" role="alert">{t("failed")}</p>
              ) : picker.status === "ready" ? (
                <div className="space-y-2">
                  {picker.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("empty")}</p>
                  ) : (
                    <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label={t("pickerTitle")}>
                      {picker.items.map((item) => {
                        const added = chosen.has(item.id);
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/30 disabled:opacity-60"
                              disabled={added}
                              aria-pressed={added}
                              onClick={() => add(item)}
                            >
                              <span className="min-w-0 truncate">{item.title}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {added ? t("added") : t("recordsCount", { count: item.count })}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {picker.nextCursor ? (
                    <Button type="button" variant="ghost" size="sm" disabled={picker.loadingMore} onClick={() => search(query, picker.nextCursor ?? undefined)}>
                      {t("loadMore")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
