"use client";

// MOCK (tag filters): the filters live in this page only and are never saved. The real build adds
// `filters.tagFilters` and `filters.collectionsMatch` to the draft through the contract sync, and a runtime read of the
// library's tags with their record counts (`zotero.runtimeReadActions.listTags`, like `listInstitutions`). Until then
// the tag search reads AIME's real tags from a snapshot of its index.

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Filter, LayoutList, Tag } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TooltipHint } from "@/components/ui/tooltip";
import { Segmented } from "@/components/settings/parts";
import { cn } from "@/lib/utils";
import { AddButton, EmptyList, FieldGroup, InlineSwitch, ListRow, move, NestedList, SortableList } from "../fields";
import { Field } from "../section-card";
import { localPickerSource, type PickerHandle, type PickerSort, RemotePickerDialog } from "./remote-picker-dialog";
import libraryTags from "./mock-library-tags.json";

type TagOption = { value: string; prefix: boolean; label: string };
export type TagFilterDraft = {
  id: string;
  label: string;
  enabled: boolean;
  placement: "card" | "picker";
  options: TagOption[];
  defaults: string[];
};

const VERIFY_LIBRARY = "r1706p6pdaz0wbdpc0yk3x33bs8fyan0";
const COUNTS = new Map(libraryTags.map((row) => [row.tag, row.count]));
const ROWS = libraryTags.map((row) => ({ id: row.tag, title: row.tag, count: row.count }));
const SORTS: readonly PickerSort[] = [
  { value: "count", column: "count", direction: "desc" },
  { value: "name", column: "title", direction: "asc" },
];

/** AIME's filters as the client asked for them, on the library the mock runs on. */
export const MOCK_TAG_FILTERS: Record<string, TagFilterDraft[]> = {
  [VERIFY_LIBRARY]: [
    {
      id: "status", label: "Status", enabled: true, placement: "card", defaults: ["Reviewed"],
      options: [
        { value: "Selected", prefix: false, label: "" },
        { value: "Reviewed", prefix: false, label: "" },
        { value: "Reviewed-Rejected", prefix: false, label: "" },
      ],
    },
    {
      id: "domain", label: "Domain", enabled: true, placement: "picker", defaults: [],
      options: [
        { value: "Domain: ", prefix: true, label: "" },
        { value: "Domain: AIG", prefix: false, label: "Item Generation" },
        { value: "Domain: Feedback", prefix: false, label: "Formative Feedback" },
      ],
    },
  ],
};

/** What readers see for a tag: its own label, else without the prefix that brings it in, else the tag. */
function readerLabel(filter: TagFilterDraft, tag: string) {
  const own = filter.options.find((option) => !option.prefix && option.value === tag)?.label;
  if (own) return own;
  const prefix = filter.options.find((option) => option.prefix && tag.startsWith(option.value));
  return prefix ? tag.slice(prefix.value.length).trim() || tag : tag;
}

const slug = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 32);

/** The library's tag filters: each a name, where readers find it, its tags or prefixes, and the tags ticked at first. */
export function TagFiltersField({ libraryId }: { libraryId: string }) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const [filters, setFilters] = useState<TagFilterDraft[]>(() => MOCK_TAG_FILTERS[libraryId] ?? []);
  const update = (id: string, change: (filter: TagFilterDraft) => TagFilterDraft) =>
    setFilters((current) => current.map((filter) => (filter.id === id ? change(filter) : filter)));
  const add = () =>
    setFilters((current) => {
      const id = `filter-${current.length + 1}`;
      return [...current, { id, label: "", enabled: true, placement: "card", options: [], defaults: [] }];
    });

  return (
    <FieldGroup title={t("heading")} hint={t("hint")} action={<AddButton onClick={add}>{t("add")}</AddButton>}>
      {filters.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <SortableList ids={filters.map((filter) => filter.id)} onMove={(from, to) => setFilters((current) => move(current, from, to))}>
          {filters.map((filter) => (
            <ListRow
              key={filter.id}
              id={filter.id}
              removeLabel={t("remove")}
              onRemove={() => setFilters((current) => current.filter((other) => other.id !== filter.id))}
            >
              <TagFilterRow filter={filter} onChange={(change) => update(filter.id, change)} />
            </ListRow>
          ))}
        </SortableList>
      )}
    </FieldGroup>
  );
}

function TagFilterRow({ filter, onChange }: { filter: TagFilterDraft; onChange: (change: (filter: TagFilterDraft) => TagFilterDraft) => void }) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const picker = useRef<PickerHandle>(null);
  const below = (text: string) => <span className="text-xs font-normal text-muted-foreground">{text}</span>;
  const named = filter.options.filter((option) => !option.prefix).map((option) => option.value);
  const addOption = (option: TagOption) =>
    onChange((f) => (f.options.some((o) => o.value === option.value && o.prefix === option.prefix) ? f : { ...f, options: [...f.options, option] }));

  return (
    <>
      <div className="flex items-start gap-3">
        <Field label={t("name")} className="min-w-0 flex-1">
          {(id) => (
            <Input
              id={id}
              className="bg-background"
              maxLength={60}
              value={filter.label}
              placeholder={t("namePlaceholder")}
              // A filter keeps the address name it got from its first name, so links readers shared keep working.
              onChange={(e) => onChange((f) => ({ ...f, label: e.target.value, id: f.label || !e.target.value ? f.id : slug(e.target.value) || f.id }))}
            />
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
      <NestedList label={t("tags")} addLabel={t("addTag")} onAdd={() => picker.current?.open()}>
        {filter.options.length > 0 ? (
          <SortableList
            className="space-y-1"
            ids={filter.options.map(optionId)}
            onMove={(from, to) => onChange((f) => ({ ...f, options: move(f.options, from, to) }))}
          >
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
                    defaults: f.defaults.filter((tag) => tag !== option.value),
                  }))
                }
              >
                {option.prefix ? (
                  <PrefixEntry filter={filter} option={option} named={named} />
                ) : (
                  <TagEntry
                    filter={filter}
                    option={option}
                    onLabel={(label) =>
                      onChange((f) => ({ ...f, options: f.options.map((o) => (optionId(o) === optionId(option) ? { ...o, label } : o)) }))
                    }
                    onDefault={(on) =>
                      onChange((f) => ({ ...f, defaults: on ? [...f.defaults, option.value] : f.defaults.filter((tag) => tag !== option.value) }))
                    }
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
        source={localPickerSource(ROWS)}
        usedIds={named}
        usedLabel={t("used")}
        loadingLabel={t("loading")}
        failedLabel={t("failed")}
        emptyLabel={t("noTags")}
        noMatchLabel={t("noMatch")}
        notSetUpLabel={t("notSetUp")}
        newLabel={(typed) => t("useTyped", { tag: typed })}
        prefix={{ label: (typed) => t("usePrefix", { prefix: typed }), onChoose: (typed) => addOption({ value: typed, prefix: true, label: "" }) }}
      />
    </>
  );
}

const optionId = (option: TagOption) => `${option.prefix ? "prefix" : "tag"}:${option.value}`;

/** A tag as the owner reads it in Zotero, set apart from what readers see. */
function TagChip({ children }: { children: string }) {
  return (
    <TooltipHint label={children} onlyWhenClipped>
      <span className="inline-flex h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 font-mono text-xs">
        <Tag className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{children}</span>
      </span>
    </TooltipHint>
  );
}

function RecordCount({ count }: { count: number | undefined }) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  return count ? (
    <span className="w-24 shrink-0 text-right text-sm tabular-nums">{t("records", { count })}</span>
  ) : (
    // Tags come and go in Zotero, so one no record carries yet still counts.
    <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{t("noRecordsYet")}</span>
  );
}

function TagEntry({ filter, option, onLabel, onDefault }: { filter: TagFilterDraft; option: TagOption; onLabel: (label: string) => void; onDefault: (on: boolean) => void }) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const checked = filter.defaults.includes(option.value);
  const id = `${filter.id}-${option.value}`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 @2xl/settings:flex-nowrap">
      <div className="w-48 shrink-0">
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
      <RecordCount count={COUNTS.get(option.value)} />
      <div className="flex h-8 shrink-0 items-center gap-2">
        <Checkbox id={id} checked={checked} onCheckedChange={(next) => onDefault(next === true)} />
        <Label htmlFor={id} className="text-xs font-normal">
          {t("tickedAtFirst")}
        </Label>
      </div>
    </div>
  );
}

/** A prefix and the tags it brings in now, each as readers see it; a tag named on its own row keeps that row's label. */
function PrefixEntry({ filter, option, named }: { filter: TagFilterDraft; option: TagOption; named: string[] }) {
  const t = useTranslations("evidenceLibraryConfiguration.search.tagFilters");
  const matches = libraryTags.filter((row) => row.tag.startsWith(option.value));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex h-8 items-center gap-x-3">
        <div className="w-48 shrink-0">
          <TagChip>{`${option.value}…`}</TagChip>
        </div>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t("prefixMeaning")}</span>
        <span className="w-24 shrink-0 text-right text-sm tabular-nums">{t("tagCount", { count: matches.length })}</span>
      </div>
      {matches.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("prefixTags")}>
          {matches.map((row) => (
            <li
              key={row.tag}
              className={cn(
                "inline-flex h-7 items-center gap-2 rounded-md border border-border-subtle px-2 text-xs",
                named.includes(row.tag) && "text-muted-foreground",
              )}
            >
              <span className="font-medium">{readerLabel(filter, row.tag)}</span>
              <span className="tabular-nums text-muted-foreground">{row.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
