"use client";

// MOCK (card tags): the settings live in this page only and are never saved. The real build adds `content.cardTags`
// to the draft, and a parent filter to the library's collection read so a collection's subcollections come in one call.

import { useAction } from "convex/react";
import { useTranslations } from "next-intl";
import { type CSSProperties, Fragment, type ReactNode, type Ref, Suspense, use, useRef, useState } from "react";
import { ChevronDown, CollectionsIcon, Plus, RotateCcw, Search, SourcesIcon, Tag, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipHint, TooltipTrigger } from "@/components/ui/tooltip";
import { Paged, pagerOf } from "@/components/settings/parts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ConfigurationDraft } from "@/lib/evidence-libraries/configuration/rules";
import type { NavIcon } from "@/lib/evidence-libraries/configuration/links";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { cn } from "@/lib/utils";
import { Disclosure } from "../disclosure-button";
import { ColourField, ColourSwatch, EmptyList, FieldGroup, HintedMenuItem, InlineSwitch, ListRow, move, SortableList } from "../fields";
import { Field, SectionCard } from "../section-card";
import { IconPreview, NavbarIconPicker } from "./navbar-icon-picker";
import { localPickerSource, PICKER_PAGE_SIZE, type PickerHandle, type PickerSource, RemotePickerDialog } from "./remote-picker-dialog";

type Look = { icon: string; color: string };
/** One collection whose subcollections are tags: its name in the database, and the name of the one it sits in. */
type ChosenCollection = { id: string; title: string; inside?: string };
/**
 * Where one set of card tags comes from: the subcollections of one or more collections, or the library's sources.
 * Subcollections of the same name are one tag, so every website's "Gender" topic is one "Gender".
 */
type TagSource = {
  id: string;
  from: "collection" | "sources";
  collections?: ChosenCollection[];
  enabled: boolean;
  /** Heads these tags where a card lists them all; empty uses the database name. */
  name: string;
  /** A member's own look: a subcollection's by its name, a source's by its key. */
  members: Record<string, Partial<Look>>;
} & Look;

type CatalogueRow = { id: string; title: string; count: number; parentId: string | null; hasChildren: boolean };
type ListAction = (args: {
  libraryId: Id<"evidenceLibraries">;
  query?: string;
  paginationOpts: { cursor: string | null; numItems: number };
}) => Promise<{ reason?: "not-set-up"; page: CatalogueRow[]; isDone: boolean; continueCursor: string }>;

/** The tag a card shows when nothing sets an icon. */
const DEFAULT_ICON = "Folder01Icon";
const MEMBERS_PER_PAGE = 8;
// A row is one line on a wide card and two on a narrow one (tag above, controls below), 1px divider included. A list
// with pages keeps a full page's height at either size, so a short last page doesn't move the pager.
const MEMBER_ROW = "h-[88px] @md/settings:h-[52px]";
const FULL_PAGE = "min-h-[713px] @md/settings:min-h-[425px]";

// The two libraries the card mock runs on, set up the same way here.
const SEEDS: Record<string, TagSource[]> = {
  r17az8jepnyqwss11yz50smkqd8gc3dk: [
    {
      id: "NFQ6KV5Z", from: "collection", collections: [{ id: "NFQ6KV5Z", title: "Websites" }], enabled: true, name: "",
      icon: "Globe02Icon", color: "#5B6B8C",
      members: {
        Agrilinks: { icon: "Plant02Icon", color: "#4D8B2F" },
        BiodiversityLinks: { icon: "Leaf01Icon", color: "#18946B" },
        "Climate Links": { icon: "SunCloud02Icon", color: "#0F8FA3" },
        EducationLinks: { icon: "Mortarboard02Icon", color: "#6D5BD0" },
        "Global Waters": { icon: "DropletIcon", color: "#2878D6" },
        Marketlinks: { icon: "Store01Icon", color: "#C06A12" },
        YouthPower: { icon: "UserGroupIcon", color: "#C2417E" },
      },
    },
    {
      id: "topics", from: "collection", enabled: true, name: "Topics", icon: "Tag01Icon", color: "", members: {},
      collections: [
        ["HUBCB9IQ", "Agrilinks"], ["4IMYBU28", "Climate Links"], ["J9XKW835", "DRG Links"], ["BSNWI5HR", "EducationLinks"],
        ["YI3P6X4D", "GenderLinks"], ["PHVY35DT", "Global Waters"], ["GFAARPGJ", "LandLinks"], ["MG7ZAF4M", "Marketlinks"],
        ["BF7CZ3WJ", "ResilienceLinks"], ["VEDRLCZD", "Urban Links"], ["A4SDVPIX", "YouthPower"],
      ].map(([id, inside]) => ({ id, title: "By Topic", inside })),
    },
  ],
  r177scvhy5cm45bdxheejxhvvd8gnn6g: [
    {
      id: "sources", from: "sources", enabled: true, name: "", icon: "", color: "",
      members: {
        "openalex-aa9bfa56-0b36-42e2-b048-2f321cb80291": { icon: "MoneyBag02Icon" },
        "openalex-19fcb057-b8bb-4e7f-b3ab-39fbc1751861": { icon: "SunCloud02Icon" },
        "openalex-c2198dff-93b5-45e6-84cd-b0d6dee24dd8": { icon: "City01Icon" },
        "openalex-a77a1430-973a-46c9-8ca3-8521cf488a84": { icon: "Mortarboard02Icon" },
        "openalex-f48e8345-260f-44e5-9a80-34264b71c885": { icon: "Rocket01Icon" },
        "openalex-d01f8d0b-5e72-43dc-a34a-a1ecc8dbd0b7": { icon: "UserMultipleIcon" },
        "openalex-6f38e73f-3d73-4bcb-bbe1-1f7d454d99b6": { icon: "WomanIcon" },
        "openalex-97069a6b-efb8-4761-b86c-e4fe2b626a02": { icon: "HealtcareIcon" },
        "openalex-e35597c8-2d11-4a5f-aa69-c470b40954b9": { icon: "Money03Icon" },
      },
    },
  ],
};

// ponytail: reads every collection, 50 at a time, to find subcollections; the real build asks for one parent's.
const catalogues = new Map<string, Promise<CatalogueRow[] | null>>();
/** The library's whole collection list, or null when it could not be read; a retry reads it again. */
function catalogue(libraryId: string, list: ListAction): Promise<CatalogueRow[] | null> {
  let promise = catalogues.get(libraryId);
  if (!promise) {
    promise = (async () => {
      const rows: CatalogueRow[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await list({ libraryId: libraryId as Id<"evidenceLibraries">, paginationOpts: { cursor, numItems: PICKER_PAGE_SIZE } });
        rows.push(...page.page);
        if (page.isDone || page.reason) return rows;
        cursor = page.continueCursor;
      }
    })().catch(() => null);
    catalogues.set(libraryId, promise);
  }
  return promise;
}

/** A member's own icon and colour, each falling back to the set's. */
const lookOf = (source: TagSource, key: string): Look => ({
  icon: source.members[key]?.icon || source.icon,
  color: source.members[key]?.color || source.color,
});

/** The tag as a record's card on the site draws it. */
function TagPreview({ name, look }: { name: string; look: Look }) {
  return (
    <TooltipHint label={name} onlyWhenClipped>
      <span
        className={cn(
          "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium",
          look.color
            ? "[background:color-mix(in_oklab,var(--tag)_14%,transparent)] [color:color-mix(in_oklab,var(--tag),black_42%)] dark:[background:color-mix(in_oklab,var(--tag)_24%,transparent)] dark:[color:color-mix(in_oklab,var(--tag),white_50%)]"
            : "bg-black/[0.05] text-black/70 dark:bg-white/[0.08] dark:text-white/75",
        )}
        style={look.color ? ({ "--tag": look.color } as CSSProperties) : undefined}
      >
        <IconPreview iconId={look.icon || DEFAULT_ICON} className={cn("size-3.5 shrink-0", !look.color && !look.icon && "opacity-70")} />
        <span className="truncate">{name}</span>
      </span>
    </TooltipHint>
  );
}

export function CardTagsSection({ libraryId, draft }: { libraryId: Id<"evidenceLibraries">; draft: ConfigurationDraft }) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const tt = useTranslations("evidenceLibraryConfiguration.cardTags");
  const list = useAction(api.zotero.runtimeReadActions.listCollections) as ListAction;
  const [sources, setSources] = useState<TagSource[]>(() => SEEDS[libraryId] ?? []);
  // The list is read once, when the page opens, so a collection's subcollections are there when it is opened.
  const [, setAttempt] = useState(0);
  const rows = catalogue(libraryId, list);
  const retry = () => {
    catalogues.delete(libraryId);
    setAttempt((attempt) => attempt + 1);
  };
  const libraryHasSources = draft.sources.filter((source) => source.enabled).length > 1;
  const sourcesAdded = sources.some((source) => source.from === "sources");
  const picker = useRef<PickerHandle>(null);
  const update = (id: string, change: (source: TagSource) => TagSource) =>
    setSources((current) => current.map((source) => (source.id === id ? change(source) : source)));
  const usedIds = sources.flatMap((source) => (source.collections ?? []).map((collection) => collection.id));

  return (
    <SectionCard id="sec-cardTags" icon={Tag} title={t("sections.cardTags")} description={tt("description")}>
      <FieldGroup
        title={tt("fromHeading")}
        hint={tt("fromHint")}
        action={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Plus />
                  {tt("add")}
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <HintedMenuItem
                  onSelect={() => picker.current?.open()}
                  icon={<CollectionsIcon className="size-4" />}
                  label={tt("addCollection")}
                  hint={tt("addCollectionHint")}
                />
                <HintedMenuItem
                  disabled={!libraryHasSources || sourcesAdded}
                  onSelect={() =>
                    setSources((current) => [...current, { id: "sources", from: "sources", enabled: true, name: "", icon: "", color: "", members: {} }])
                  }
                  icon={<SourcesIcon className="size-4" />}
                  label={tt("addSources")}
                  hint={sourcesAdded ? tt("sourcesAdded") : libraryHasSources ? tt("addSourcesHint") : tt("sourcesNeedTwo")}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <CollectionPicker
              ref={picker}
              rows={rows}
              usedIds={usedIds}
              onConfirm={(picked) =>
                setSources((current) => [
                  ...current,
                  { id: picked[0]!.id, from: "collection", collections: picked, enabled: true, name: "", icon: "", color: "", members: {} },
                ])
              }
            />
          </>
        }
      >
        {sources.length === 0 ? (
          <EmptyList>{tt("empty")}</EmptyList>
        ) : (
          <SortableList ids={sources.map((source) => source.id)} onMove={(from, to) => setSources((current) => move(current, from, to))}>
            {sources.map((source) => (
              <ListRow
                key={source.id}
                id={source.id}
                removeLabel={tt("remove")}
                onRemove={() => setSources((current) => current.filter((other) => other.id !== source.id))}
              >
                <TagSourceRow
                  source={source}
                  draft={draft}
                  libraryId={libraryId}
                  rows={rows}
                  retry={retry}
                  usedIds={usedIds}
                  onChange={(change) => update(source.id, change)}
                />
              </ListRow>
            ))}
          </SortableList>
        )}
      </FieldGroup>
    </SectionCard>
  );
}

function TagSourceRow({
  source,
  draft,
  libraryId,
  rows,
  retry,
  usedIds,
  onChange,
}: {
  source: TagSource;
  draft: ConfigurationDraft;
  libraryId: Id<"evidenceLibraries">;
  rows: Promise<CatalogueRow[] | null>;
  retry: () => void;
  usedIds: string[];
  onChange: (change: (source: TagSource) => TagSource) => void;
}) {
  const tt = useTranslations("evidenceLibraryConfiguration.cardTags");
  const [open, setOpen] = useState(false);
  const collections = source.collections ?? [];
  const databaseName = collections[0]?.title ?? draft.filters.sources.label;
  const Icon = source.from === "collection" ? CollectionsIcon : SourcesIcon;
  return (
    <>
      {/* The line reads as a sentence: "Subcollections of By Topic in Agrilinks, Climate Links…", each a removable chip. */}
      <div className="flex items-start gap-2">
        <span className="flex h-7 shrink-0 items-center">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm font-medium">
          {source.from === "collection" ? (
            <>
              <span className="flex h-7 items-center">{tt("subcollectionsOf")}</span>
              {Object.entries(Object.groupBy(collections, (collection) => collection.title)).map(([title, same]) =>
                same![0]!.inside ? (
                  <Fragment key={title}>
                    <span className="flex h-7 items-center">{tt("titleIn", { title })}</span>
                    {same!.map((collection) => (
                      <CollectionChip
                        key={collection.id}
                        label={collection.inside!}
                        removable={collections.length > 1}
                        onRemove={() => onChange((s) => ({ ...s, collections: s.collections!.filter((other) => other.id !== collection.id) }))}
                      />
                    ))}
                  </Fragment>
                ) : (
                  same!.map((collection) => (
                    <CollectionChip
                      key={collection.id}
                      label={collection.title}
                      removable={collections.length > 1}
                      onRemove={() => onChange((s) => ({ ...s, collections: s.collections!.filter((other) => other.id !== collection.id) }))}
                    />
                  ))
                ),
              )}
              <CollectionPicker
                rows={rows}
                usedIds={usedIds}
                trigger={
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                    <Plus className="size-3.5" />
                    {tt("addMore")}
                  </Button>
                }
                onConfirm={(picked) => onChange((s) => ({ ...s, collections: [...(s.collections ?? []), ...picked] }))}
              />
            </>
          ) : (
            <span className="flex h-7 items-center">{tt("theSources")}</span>
          )}
        </div>
        <div className="-my-1 shrink-0">
          <InlineSwitch label={tt("onCards")} checked={source.enabled} onChange={(enabled) => onChange((s) => ({ ...s, enabled }))} />
        </div>
      </div>
      <div className="grid gap-3 @2xl/settings:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)]">
        <Field label={tt("nameLabel")} hint={tt("nameHint")}>
          {(id) => (
            <Input
              id={id}
              className="bg-background"
              maxLength={60}
              value={source.name}
              placeholder={databaseName}
              onChange={(e) => onChange((s) => ({ ...s, name: e.target.value }))}
            />
          )}
        </Field>
        <Field label={tt("iconLabel")}>
          {(id) => (
            <NavbarIconPicker
              id={id}
              value={source.icon as NavIcon | ""}
              placeholder={tt("defaultIcon")}
              onChange={(icon) => onChange((s) => ({ ...s, icon }))}
            />
          )}
        </Field>
        <ColourField label={tt("colourLabel")} optional value={source.color} onChange={(color) => onChange((s) => ({ ...s, color }))} />
      </div>
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        label={source.from === "collection" ? tt("eachSubcollection") : tt("eachSource")}
      >
        <Suspense
          fallback={
            <div className="flex h-10 items-center pl-1">
              <Spinner className="size-4" aria-label={tt("loadingMembers")} />
            </div>
          }
        >
          <Members source={source} draft={draft} libraryId={libraryId} rows={rows} retry={retry} onChange={onChange} />
        </Suspense>
      </Disclosure>
    </>
  );
}

type Member = { key: string; name: string };

/** The subcollections or sources a set's tags name, each with its own look or the set's. */
function Members(props: {
  source: TagSource;
  draft: ConfigurationDraft;
  libraryId: Id<"evidenceLibraries">;
  rows: Promise<CatalogueRow[] | null>;
  retry: () => void;
  onChange: (change: (source: TagSource) => TagSource) => void;
}) {
  return props.source.from === "collection" ? <CollectionMembers {...props} /> : <SourceMembers {...props} />;
}

function CollectionMembers({
  source,
  rows,
  retry,
  onChange,
}: {
  source: TagSource;
  rows: Promise<CatalogueRow[] | null>;
  retry: () => void;
  onChange: (change: (source: TagSource) => TagSource) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const all = use(rows);
  if (!all) {
    return (
      <div className="flex items-center gap-3 pl-1 text-sm text-muted-foreground">
        {t("collections.failed")}
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  // Subcollections of the same name under different collections are one tag.
  const parents = new Set((source.collections ?? []).map((collection) => collection.id));
  const names = [...new Set(all.filter((row) => row.parentId && parents.has(row.parentId)).map((row) => row.title))];
  const members = names.sort((a, b) => a.localeCompare(b)).map((name) => ({ key: name, name }));
  return <MemberList source={source} members={members} onChange={onChange} />;
}

function SourceMembers({
  source,
  draft,
  libraryId,
  onChange,
}: {
  source: TagSource;
  draft: ConfigurationDraft;
  libraryId: Id<"evidenceLibraries">;
  onChange: (change: (source: TagSource) => TagSource) => void;
}) {
  const groups = useProtectedQuery(api.zotero.libraryGroups.listZoteroGroups, { libraryId });
  const groupName = new Map((groups.data?.page ?? []).map((group) => [group.groupId, group.name]));
  const members = draft.sources
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      key: entry.key,
      name: entry.provider === "zotero" ? (groupName.get(entry.groupId) ?? entry.groupId) : entry.settings.name,
    }));
  return <MemberList source={source} members={members} onChange={onChange} />;
}

function MemberList({
  source,
  members,
  onChange,
}: {
  source: TagSource;
  members: Member[];
  onChange: (change: (source: TagSource) => TagSource) => void;
}) {
  const tt = useTranslations("evidenceLibraryConfiguration.cardTags");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  // A long list (every website's topics) is found by name; a short one shows whole.
  const searchable = members.length > MEMBERS_PER_PAGE;
  const text = query.trim().toLowerCase();
  const matching = text ? members.filter((member) => member.name.toLowerCase().includes(text)) : members;
  const pager = pagerOf(matching.length, MEMBERS_PER_PAGE, page, setPage);
  const shown = matching.slice((pager.page - 1) * MEMBERS_PER_PAGE, pager.page * MEMBERS_PER_PAGE);
  const setMember = (key: string, look: Partial<Look>) =>
    onChange((s) => {
      const own = { ...s.members[key], ...look };
      const members = { ...s.members };
      if (own.icon || own.color) members[key] = own;
      else delete members[key];
      return { ...s, members };
    });
  return (
    <div className="space-y-2 pt-1">
      {searchable ? (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label={tt("searchMembers", { count: members.length })}
            placeholder={tt("searchMembers", { count: members.length })}
            className="bg-background pl-9"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
      ) : null}
      <Paged pager={pager} rowHeight={0} label={tt("membersLabel")}>
        <div className={pager.pages > 1 ? FULL_PAGE : undefined}>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-background">
            {shown.length === 0 ? (
              <li className={cn("flex items-center px-3 text-sm text-muted-foreground", MEMBER_ROW)}>{tt("noMemberMatch")}</li>
            ) : null}
            {shown.map((member, index) => {
              const own = source.members[member.key] ?? {};
              const look = lookOf(source, member.key);
              return (
                // A narrow card gives the tag its own line, so its name is never cut to nothing.
                <li key={member.key} className={cn("flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 px-3 py-2 @md/settings:flex-nowrap @md/settings:py-0", MEMBER_ROW)} data-member={member.key}>
                  <div className="min-w-0 basis-full @md/settings:flex-1 @md/settings:basis-auto">
                    <TagPreview name={member.name} look={look} />
                  </div>
                  <NavbarIconPicker
                    id={`member-icon-${source.id}-${pager.page}-${index}`}
                    value={(own.icon ?? "") as NavIcon | ""}
                    placeholder={tt("sameAsAll")}
                    compact={{ label: tt("memberIcon", { name: member.name }), shown: source.icon || DEFAULT_ICON }}
                    onChange={(icon) => setMember(member.key, { icon })}
                  />
                  <ColourSwatch
                    value={own.color ?? ""}
                    optional
                    inherited={source.color}
                    label={tt("memberColour", { name: member.name })}
                    onChange={(color) => setMember(member.key, { color })}
                  />
                  {own.icon || own.color ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={tt("useAllLook")}
                          onClick={() => setMember(member.key, { icon: "", color: "" })}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{tt("useAllLook")}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="size-9 shrink-0" aria-hidden />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Paged>
    </div>
  );
}

/** A collection an entry takes subcollections from, removable while another is left. */
function CollectionChip({ label, removable, onRemove }: { label: string; removable: boolean; onRemove: () => void }) {
  const tt = useTranslations("evidenceLibraryConfiguration.cardTags");
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md border border-border-subtle bg-background pr-1 pl-2 text-xs font-medium">
      {label}
      {removable ? (
        <button
          type="button"
          aria-label={tt("removeCollection", { name: label })}
          onClick={onRemove}
          className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="w-1" aria-hidden />
      )}
    </span>
  );
}

/**
 * Picks collections that have subcollections, from the list already read. It names the collection each sits in,
 * since a library can hold many of the same name (USAID has a "By Topic" in every website).
 */
function CollectionPicker({
  rows,
  usedIds,
  trigger,
  ref,
  onConfirm,
}: {
  rows: Promise<CatalogueRow[] | null>;
  usedIds: string[];
  trigger?: ReactNode;
  ref?: Ref<PickerHandle>;
  onConfirm: (picked: ChosenCollection[]) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const tt = useTranslations("evidenceLibraryConfiguration.cardTags");
  const readPage: PickerSource = async (input) => {
    const all = await rows;
    if (!all) throw new Error("The library's collections could not be read.");
    const title = new Map(all.map((row) => [row.id, row.title]));
    const parents = all
      .filter((row) => row.hasChildren)
      .map((row) => ({ id: row.id, title: row.title, meta: row.parentId ? title.get(row.parentId) : undefined, count: row.count }));
    return localPickerSource(parents, PICKER_PAGE_SIZE)(input);
  };
  return (
    <RemotePickerDialog
      ref={ref}
      trigger={trigger}
      mode="multi"
      title={tt("picker.title")}
      description={tt("picker.description")}
      searchLabel={t("collections.picker.search")}
      columns={{ title: t("collections.picker.colTitle"), meta: tt("picker.colInside"), count: t("collections.picker.colRecords") }}
      source={readPage}
      usedIds={usedIds}
      usedLabel={tt("picker.used")}
      loadingLabel={t("collections.loading")}
      failedLabel={t("collections.failed")}
      emptyLabel={t("collections.noneInDatabase")}
      noMatchLabel={t("collections.picker.noMatch")}
      notSetUpLabel={t("collections.notSetUp")}
      confirmLabel={(count) => t("collections.picker.addPicked", { count })}
      onConfirm={(picked) => {
        if (picked.length) onConfirm(picked.map((row) => ({ id: row.id, title: row.title, inside: row.meta })));
      }}
    />
  );
}
