"use client";

import { useAction } from "convex/react";
import { useTranslations } from "next-intl";
import { Suspense, use, useRef, useState } from "react";
import { Filter, LayoutList, Tag } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TooltipHint } from "@/components/ui/tooltip";
import { Segmented } from "@/components/settings/parts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SCHEMA_LIMITS, TAG_FILTER_ID, TAG_FILTER_TAG, type TagFilterDraft, type TagFilterOptionDraft } from "@/lib/evidence-libraries/configuration/rules";
import { cn } from "@/lib/utils";
import { AddButton, EmptyList, FieldGroup, InlineSwitch, ListRow, move, NestedList, SortableList } from "../fields";
import { Field } from "../section-card";
import { PICKER_PAGE_SIZE, type PickerHandle, type PickerSort, type PickerSource, RemotePickerDialog } from "./remote-picker-dialog";

type TagPage = { reason?: "not-set-up"; page: { name: string; count: number }[]; isDone: boolean; continueCursor: string };
type ListTags = (args: {
  libraryId: Id<"evidenceLibraries">;
  query?: string;
  paginationOpts: { cursor: string | null; numItems: number };
  sort?: "count" | "name";
  direction?: "asc" | "desc";
}) => Promise<TagPage>;
/** Tags and their record counts, or null when they could not be read; `complete` when the read held every match. */
type TagCounts = { counts: Map<string, number>; complete: boolean } | null;

const SORTS: readonly PickerSort[] = [
  { value: "count", column: "count", direction: "desc" },
  { value: "name", column: "title", direction: "asc" },
];
const LIMITS = SCHEMA_LIMITS.filters;

const tagCountReads = new Map<string, Promise<TagCounts>>();
/**
 * One page of tags, most used first, read once per library and text: with no text, the library's most used tags, which
 * the rows' counts come from; with a prefix, the tags it brings in. A page is all a count needs: an entry is named
 * because it is used, and a long prefix list says it goes on.
 */
function tagCounts(libraryId: Id<"evidenceLibraries">, list: ListTags, query: string): Promise<TagCounts> {
  const key = `${libraryId}\u0000${query}`;
  let read = tagCountReads.get(key);
  if (!read) {
    read = list({ libraryId, query: query || undefined, paginationOpts: { cursor: null, numItems: PICKER_PAGE_SIZE } })
      .then((page) => ({ counts: new Map(page.page.map((row) => [row.name, row.count])), complete: page.isDone }))
      .catch(() => null);
    tagCountReads.set(key, read);
  }
  return read;
}

/** A typed tag or prefix the contract accepts in a tag filter. */
const acceptsTag = (typed: string) => typed.length <= LIMITS.tagFilterTag && TAG_FILTER_TAG.test(typed);

const slug = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 32);
const optionId = (option: TagFilterOptionDraft) => `${option.prefix ? "prefix" : "tag"}:${option.value}`;

/** What readers see for a tag: its own label, else without the prefix that brings it in, else the tag. */
function readerLabel(filter: TagFilterDraft, tag: string) {
  const own = filter.options.find((option) => !option.prefix && option.value === tag)?.label;
  if (own) return own;
  const prefix = filter.options.find((option) => option.prefix && tag.startsWith(option.value));
  return prefix ? tag.slice(prefix.value.length).trim() || tag : tag;
}

/** The library's tag filters: each a name, where readers find it, its tags or prefixes, and the tags ticked at first. */
export function TagFiltersField({
  libraryId,
  filters,
  onChange,
}: {
  libraryId: Id<"evidenceLibraries">;
  filters: TagFilterDraft[];
  onChange: (change: (filters: TagFilterDraft[]) => TagFilterDraft[]) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const list = useAction(api.zotero.runtimeReadActions.listTags) as ListTags;
  const libraryCounts = tagCounts(libraryId, list, "");
  const prefixCounts = (prefix: string) => tagCounts(libraryId, list, prefix);
  const update = (id: string, change: (filter: TagFilterDraft) => TagFilterDraft) =>
    onChange((current) => current.map((filter) => (filter.id === id ? change(filter) : filter)));
  // A row keeps its key when its filter's address name settles, so the click that left the name field still lands.
  const [rowKeys, setRowKeys] = useState<Record<string, string>>({});
  // A key a filter took back, as when Reset brings back the one renamed away from it, stays that filter's own.
  const rowKey = (id: string) => {
    const key = rowKeys[id];
    return key && !filters.some((filter) => filter.id === key) ? key : id;
  };
  const rename = (id: string, fresh: string) => {
    setRowKeys((keys) => ({ ...keys, [fresh]: keys[id] ?? id }));
    update(id, (filter) => ({ ...filter, id: fresh }));
  };
  const add = () =>
    onChange((current) => {
      // A new filter's address name only has to be unique; it takes the first name the owner types.
      let n = current.length + 1;
      while (current.some((filter) => filter.id === `filter-${n}` || rowKey(filter.id) === `filter-${n}`)) n += 1;
      return [...current, { id: `filter-${n}`, label: "", enabled: true, placement: "card", options: [], defaults: [] }];
    });
  const source: PickerSource = async ({ query, cursor, sort, direction }) => {
    const page = await list({
      libraryId,
      query: query || undefined,
      paginationOpts: { cursor, numItems: PICKER_PAGE_SIZE },
      sort: sort === "name" ? "name" : "count",
      direction: direction ?? undefined,
    });
    return {
      reason: page.reason,
      items: page.page.map((row) => ({ id: row.name, title: row.name, count: row.count })),
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  };

  return (
    <FieldGroup title={t("heading")} hint={t("hint")} action={<AddButton onClick={add} disabled={filters.length >= LIMITS.tagFilters}>{t("add")}</AddButton>}>
      {filters.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <SortableList ids={filters.map((filter) => filter.id)} onMove={(from, to) => onChange((current) => move(current, from, to))}>
          {filters.map((filter) => (
            <ListRow
              key={rowKey(filter.id)}
              id={filter.id}
              removeLabel={t("remove")}
              onRemove={() => onChange((current) => current.filter((other) => other.id !== filter.id))}
            >
              <TagFilterRow
                filter={filter}
                taken={filters.filter((other) => other.id !== filter.id).map((other) => other.id)}
                libraryCounts={libraryCounts}
                prefixCounts={prefixCounts}
                source={source}
                onChange={(change) => update(filter.id, change)}
                onRename={(fresh) => rename(filter.id, fresh)}
              />
            </ListRow>
          ))}
        </SortableList>
      )}
    </FieldGroup>
  );
}

function TagFilterRow({
  filter,
  taken,
  libraryCounts,
  prefixCounts,
  source,
  onChange,
  onRename,
}: {
  filter: TagFilterDraft;
  /** Other filters' address names, which this one can't take. */
  taken: string[];
  libraryCounts: Promise<TagCounts>;
  prefixCounts: (prefix: string) => Promise<TagCounts>;
  source: PickerSource;
  onChange: (change: (filter: TagFilterDraft) => TagFilterDraft) => void;
  /** Gives a new filter its address name. */
  onRename: (id: string) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const picker = useRef<PickerHandle>(null);
  const below = (text: string) => <span className="text-xs font-normal text-muted-foreground">{text}</span>;
  const named = filter.options.filter((option) => !option.prefix).map((option) => option.value);
  const addOption = (option: TagFilterOptionDraft) =>
    onChange((f) => (f.options.some((o) => optionId(o) === optionId(option)) ? f : { ...f, options: [...f.options, option] }));
  // A new filter takes its address name from its first name once the field is left, not while the owner types; it keeps
  // that name after, so links readers shared keep working. A name the contract refuses, a search option's, leaves it as is.
  const settleId = () => {
    const fresh = /^filter-\d+$/u.test(filter.id) && slug(filter.label);
    if (fresh && TAG_FILTER_ID.test(fresh) && !taken.includes(fresh)) onRename(fresh);
  };

  return (
    <>
      <div className="flex items-start gap-3">
        <Field label={t("name")} className="min-w-0 flex-1">
          {(id) => (
            <Input id={id} className="bg-background" maxLength={60} value={filter.label} placeholder={t("namePlaceholder")} onChange={(e) => onChange((f) => ({ ...f, label: e.target.value }))} onBlur={settleId} />
          )}
        </Field>
        <div className="mt-6 shrink-0">
          <InlineSwitch label={t("onSite")} checked={filter.enabled} onChange={(enabled) => onChange((f) => ({ ...f, enabled }))} />
        </div>
      </div>
      <Segmented
        fill
        label={t("showAs")}
        value={filter.placement}
        onChange={(placement) => onChange((f) => ({ ...f, placement }))}
        options={[
          { id: "card", label: t("card"), icon: LayoutList, below: below(t("cardDetail")) },
          { id: "picker", label: t("picker"), icon: Filter, below: below(t("pickerDetail")) },
        ]}
      />
      <NestedList label={t("tags")} addLabel={t("addTag")} onAdd={() => picker.current?.open()} disabled={filter.options.length >= LIMITS.tagFilterOptions}>
        {filter.options.length > 0 ? (
          <SortableList className="space-y-1" ids={filter.options.map(optionId)} onMove={(from, to) => onChange((f) => ({ ...f, options: move(f.options, from, to) }))}>
            {filter.options.map((option) => (
              <ListRow
                key={optionId(option)}
                id={optionId(option)}
                removeLabel={t("removeTag")}
                // Grip and remove sit on the entry's first line, beside the tag, however many lines follow.
                className="items-start border-0 bg-transparent p-0 [&>button:last-child]:h-8"
                onRemove={() =>
                  onChange((f) => ({
                    ...f,
                    options: f.options.filter((o) => optionId(o) !== optionId(option)),
                    defaults: option.prefix ? f.defaults : f.defaults.filter((tag) => tag !== option.value),
                  }))
                }
              >
                {option.prefix ? (
                  <PrefixEntry filter={filter} option={option} named={named} counts={prefixCounts(option.value)} />
                ) : (
                  <TagEntry
                    filter={filter}
                    option={option}
                    counts={libraryCounts}
                    defaultsFull={filter.defaults.length >= LIMITS.tagFilterDefaults}
                    onLabel={(label) => onChange((f) => ({ ...f, options: f.options.map((o) => (optionId(o) === optionId(option) ? { ...o, label } : o)) }))}
                    onDefault={(on) => onChange((f) => ({ ...f, defaults: on ? [...f.defaults, option.value] : f.defaults.filter((tag) => tag !== option.value) }))}
                  />
                )}
              </ListRow>
            ))}
          </SortableList>
        ) : null}
      </NestedList>
      <RemotePickerDialog
        ref={picker}
        mode="single"
        value=""
        onChoose={(row) => row && addOption({ value: row.id, prefix: false, label: "" })}
        title={t("pickerTitle", { name: filter.label || t("namePlaceholder") })}
        description={t("pickerDescription")}
        searchLabel={t("pickerSearch")}
        columns={{ title: t("colTag"), count: t("colRecords") }}
        sorts={SORTS}
        source={source}
        usedIds={named}
        usedLabel={t("used")}
        loadingLabel={t("loading")}
        failedLabel={t("failed")}
        emptyLabel={t("noTags")}
        noMatchLabel={t("noMatch")}
        notSetUpLabel={t("notSetUp")}
        newLabel={(typed) => t("useTyped", { tag: typed })}
        prefix={{ label: (typed) => t("usePrefix", { prefix: typed }), onChoose: (typed) => addOption({ value: typed, prefix: true, label: "" }) }}
        typedAccepts={acceptsTag}
        rowFilter={(row) => acceptsTag(row.id)}
      />
    </>
  );
}

/** A tag as the owner reads it in Zotero, set apart from what readers see. */
function TagChip({ children }: { children: string }) {
  return (
    <TooltipHint label={children} onlyWhenClipped>
      <span className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 font-mono text-xs">
        <Tag className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{children}</span>
      </span>
    </TooltipHint>
  );
}

/** A count's place keeps its width while the counts are read, then the count fades in. */
const COUNT_SLOT = "w-24 shrink-0 text-end";

function RecordCount({ tag, counts }: { tag: string; counts: Promise<TagCounts> }) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const read = use(counts);
  const count = read?.counts.get(tag);
  if (count) return <span className={cn(COUNT_SLOT, "animate-in fade-in text-sm tabular-nums")}>{t("records", { count })}</span>;
  // Tags come and go in Zotero, so one no record carries yet still counts; only a list read whole can say so.
  return read?.complete ? <span className={cn(COUNT_SLOT, "animate-in fade-in text-xs text-muted-foreground")}>{t("noRecordsYet")}</span> : <span className={COUNT_SLOT} />;
}

function TagEntry({
  filter,
  option,
  counts,
  defaultsFull,
  onLabel,
  onDefault,
}: {
  filter: TagFilterDraft;
  option: TagFilterOptionDraft;
  counts: Promise<TagCounts>;
  /** The filter has as many tags ticked at first as it can hold, so only ticked ones can change. */
  defaultsFull: boolean;
  onLabel: (label: string) => void;
  onDefault: (on: boolean) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const id = `${filter.id}-${option.value}`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 @2xl/settings:flex-nowrap">
      <div className="w-48 min-w-0">
        <TagChip>{option.value}</TagChip>
      </div>
      <Input
        aria-label={t("labelFor", { tag: option.value })}
        className="h-8 min-w-40 flex-1 bg-background"
        maxLength={80}
        value={option.label}
        placeholder={readerLabel({ ...filter, options: filter.options.filter((o) => o !== option) }, option.value)}
        onChange={(e) => onLabel(e.target.value)}
      />
      <Suspense fallback={<span className={COUNT_SLOT} />}>
        <RecordCount tag={option.value} counts={counts} />
      </Suspense>
      <div className="flex h-8 shrink-0 items-center gap-2">
        <Checkbox
          id={id}
          checked={filter.defaults.includes(option.value)}
          disabled={defaultsFull && !filter.defaults.includes(option.value)}
          onCheckedChange={(next) => onDefault(next === true)}
        />
        <Label htmlFor={id} className="text-xs font-normal">
          {t("tickedAtFirst")}
        </Label>
      </div>
    </div>
  );
}

/** A prefix and the tags it brings in now, each as readers see it; a tag named on its own row keeps that row's label. */
function PrefixEntry({ filter, option, named, counts }: { filter: TagFilterDraft; option: TagFilterOptionDraft; named: string[]; counts: Promise<TagCounts> }) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex h-8 items-center gap-x-3">
        <div className="w-48 min-w-0">
          <TagChip>{`${option.value}…`}</TagChip>
        </div>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t("prefixMeaning")}</span>
      </div>
      <Suspense fallback={null}>
        <PrefixTags filter={filter} prefix={option.value} named={named} counts={counts} />
      </Suspense>
    </div>
  );
}

function PrefixTags({ filter, prefix, named, counts }: { filter: TagFilterDraft; prefix: string; named: string[]; counts: Promise<TagCounts> }) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const read = use(counts);
  const matches = [...(read?.counts ?? [])].filter(([tag]) => tag.startsWith(prefix)).sort((left, right) => right[1] - left[1]);
  if (matches.length === 0) return null;
  return (
    <ul className="flex animate-in fade-in flex-wrap items-center gap-1.5" aria-label={t("prefixTags")}>
      {matches.map(([tag, count]) => (
        <li key={tag} className={cn("inline-flex h-7 items-center gap-2 rounded-md border border-border-subtle px-2 text-xs", named.includes(tag) && "text-muted-foreground")}>
          <span className="font-medium">{readerLabel(filter, tag)}</span>
          <span className="tabular-nums text-muted-foreground">{count}</span>
        </li>
      ))}
      {read?.complete ? null : <li className="px-1 text-xs text-muted-foreground">{t("prefixMore")}</li>}
    </ul>
  );
}
