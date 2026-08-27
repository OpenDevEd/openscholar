"use client";

import { useAction } from "convex/react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { EmptyList, FieldGroup, ListRow, move, SortableList } from "../fields";
import { type PickerRow, type PickerSource, RemotePickerDialog } from "./remote-picker-dialog";

export type CollectionEntry = {
  id: string;
  title?: string;
  enabled?: boolean;
  order?: number;
};

type CataloguePage = {
  reason?: "not-set-up";
  items: { id: string; title: string; count: number; source: string; parentId: string | null }[];
  nextCursor: string | null;
};

type ListAction = (args: {
  libraryId: Id<"evidenceLibraries">;
  query?: string;
  cursor?: string;
}) => Promise<CataloguePage>;

export const COLLECTION_TITLE_MAX = 100;

// Renumbers `order` so rows keep the order they are shown in.
export function renumber(entries: readonly CollectionEntry[]): CollectionEntry[] {
  return entries.map((entry, index) => ({ ...entry, order: index }));
}

export function sortedEntries(entries: readonly CollectionEntry[]): CollectionEntry[] {
  return [...entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Field body for the Collections section: the collections shown on the
 * site, in order, with a title override, and a picker that searches the
 * library's own database one page at a time.
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
  // What the picker has read about a collection, kept so a chosen row can
  // show its database name and record count.
  const [known, setKnown] = useState<Map<string, PickerRow>>(new Map());
  const [source, setSource] = useState<string | null>(null);
  const [hideShown, setHideShown] = useState(true);
  const shown = sortedEntries(value);
  const shownIds = shown.map((entry) => entry.id);

  const readPage: PickerSource = async ({ query, cursor }) => {
    const page = await listCollections({
      libraryId,
      query: query || undefined,
      cursor: cursor ?? undefined,
    });
    return {
      reason: page.reason,
      items: page.items.map((item) => ({
        id: item.id,
        title: item.title,
        meta: item.source,
        count: item.count,
      })),
      nextCursor: page.nextCursor,
    };
  };

  function add(rows: PickerRow[]) {
    const next = [...shown];
    for (const row of rows) {
      if (next.some((entry) => entry.id === row.id)) continue;
      next.push({ id: row.id, enabled: true });
    }
    onChange(renumber(next));
  }

  return (
    <FieldGroup
      title={t("shownHeading")}
      hint={t("introHint")}
      action={
        <RemotePickerDialog
          mode="multi"
          trigger={
            <Button type="button" variant="outline" size="sm">
              <Plus />
              {t("picker.open")}
            </Button>
          }
          title={t("picker.title")}
          description={t("picker.description")}
          searchLabel={t("picker.search")}
          columns={{ title: t("picker.colTitle"), meta: t("picker.colSource"), count: t("picker.colRecords") }}
          source={readPage}
          usedIds={shownIds}
          usedLabel={t("picker.shown")}
          emptyLabel={t("noneInDatabase")}
          noMatchLabel={t("picker.noMatch")}
          notSetUpLabel={t("notSetUp")}
          onRowsLoaded={(rows) =>
            setKnown((current) => {
              const next = new Map(current);
              for (const row of rows) next.set(row.id, row);
              return next;
            })
          }
          onOpenChange={(open) => {
            if (open) return;
            setSource(null);
            setHideShown(true);
          }}
          rowFilter={(row) =>
            (!source || row.meta === source) && (!hideShown || !shownIds.includes(row.id))
          }
          controls={(rows) => (
            <>
              <FilterChip active={source === null} onClick={() => setSource(null)}>
                {t("picker.allSources")}
              </FilterChip>
              {[...new Set(rows.map((row) => row.meta ?? ""))]
                .filter(Boolean)
                .map((one) => (
                  <FilterChip key={one} active={source === one} onClick={() => setSource(one)}>
                    {one}
                  </FilterChip>
                ))}
              <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={hideShown} onCheckedChange={(v) => setHideShown(v === true)} />
                {t("picker.hideShown")}
              </label>
            </>
          )}
          confirmLabel={(count) => t("picker.addPicked", { count })}
          onConfirm={add}
        />
      }
    >
      {shown.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <SortableList
          ids={shownIds}
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
                known={known.get(entry.id)}
                onTitle={(title) =>
                  onChange(
                    shown.map((row) =>
                      row.id === entry.id ? { ...row, title: title || undefined } : row,
                    ),
                  )
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
  known,
  onTitle,
}: {
  entry: CollectionEntry;
  known: PickerRow | undefined;
  onTitle: (title: string) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.collections");
  const id = useId();
  const databaseTitle = known?.title ?? entry.title ?? entry.id;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{databaseTitle}</span>
        {known?.count !== undefined ? (
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {t("records", { count: known.count })}
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
          placeholder={databaseTitle}
          onChange={(e) => onTitle(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("titleHint")}</p>
      </div>
    </>
  );
}

/** One filter chip: the source a collection came from. */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
