"use client";

// The places a screening's papers come from that take more than a list to pick from: a Zotero
// account's libraries and their collections, pasted DOIs, a table whose columns have to be named,
// and the list of what a source held and the screening doesn't take.

import { useId, useState, type ReactNode } from "react";
import NextLink from "next/link";
import { toast } from "sonner";
import { Check, ChevronRight, ChevronsUpDown, Copy, FileSpreadsheet, Folder, Hash, Library, Plus, Search, Trash2, TriangleAlert, Undo2, UserRound, Users, type AppIcon } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { Chip, RequiredMark } from "@/components/screening/parts";
import { Segmented, pagerOf } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { FadeRow } from "@/components/ui/fade-row";
import { HelpFact } from "@/components/ui/help";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { num, plural, type Source } from "./data";
import { ZOTERO, zoteroDeep, zoteroInside, zoteroPath, zoteroUnder, type Offer, type ZoteroCollection, type ZoteroLibrary } from "./form-data";
import { Help, INLINE_LINK, StateChip, type Tone } from "./parts";
import { COLUMN_KEYS, COLUMN_LABEL, doisIn, tableCounts, type ColumnKey, type TableRead } from "./upload-read";

const PAGE = 5;
/** A row's height with its line: a list keeps its page's height on a last page that holds fewer. */
const ROW = 57;

/** Something that can be added as a source: what it is, how many papers it holds, and the button that adds it. */
export function OfferRow({ offer, icon: Icon, chips, trail, added, onAdd, onOpen }: {
  offer: Offer;
  icon: AppIcon;
  /** What else tells this row from the others, after its detail. */
  chips?: ReactNode;
  /** Where it sits, as steps that lead back up, in place of its detail. */
  trail?: ReactNode;
  added: boolean;
  onAdd: () => void;
  /** Where it holds more to pick from: its name is then the way in. */
  onOpen?: () => void;
}) {
  const name = "truncate max-sm:line-clamp-2 max-sm:whitespace-normal";
  const second = Boolean(trail || offer.detail || offer.filters?.length || chips);
  return (
    <div className="flex min-h-14 items-center gap-x-3 gap-y-1.5 px-1 py-2.5 max-sm:flex-wrap">
      <div className="min-w-0 flex-1 max-sm:basis-full">
        {/* The icon is part of the name's line, so it sits on it whether or not a second line follows. */}
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-5 shrink-0 items-center"><Icon className="size-4 text-muted-foreground" /></span>
          {onOpen ? (
            <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-1 rounded text-start text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
              <span className={name}>{offer.name}</span>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <p className={cn("min-w-0 text-sm font-medium", name)}>{offer.name}</p>
          )}
        </div>
        {trail ? (
          <div className="ps-7">{trail}</div>
        ) : second ? (
          <p className="flex min-w-0 items-center gap-1.5 ps-7 text-xs text-muted-foreground"><span className="truncate">{offer.detail}</span>{offer.filters?.map((filter) => <Chip key={filter} className="h-5 px-1.5 @max-xl:hidden">{filter}</Chip>)}{chips ? <span className="flex shrink-0 items-center gap-1.5 @max-xl:hidden">{chips}</span> : null}</p>
        ) : null}
      </div>
      <Chip className="max-sm:ms-7">{plural(offer.total, "paper", "papers")}</Chip>
      <Button variant="outline" size="sm" className="w-24 max-sm:ms-auto" disabled={added || !offer.total} onClick={onAdd}>{added ? <><Check />Added</> : !offer.total ? "Empty" : <><Plus />Add</>}</Button>
    </div>
  );
}

/** What picking from Zotero adds: the whole of a library, or one collection of it with or without the ones under it. */
export type ZoteroPick = { ref: string; name: string; detail: string; total: number; filters: string[]; /** How many in a hundred of the library's papers carry an abstract. */ abstracts: number };

const libraryIcon = (library: ZoteroLibrary) => (library.group ? Users : UserRound);
const inWords = (path: ZoteroCollection[]) => path.map((one) => one.name).join(" › ");

/**
 * A Zotero account's libraries: the person's own and each group they are in. One is picked, then all of
 * it or any of its collections is added, a collection at a time. The list's first row is where it
 * stands, the library or a collection opened from it, with the way back up; under it are the
 * collections there. A collection's count takes in those under it while "Include sub-collections" is on.
 */
export function ZoteroTab({ connected, account, onConnect, sources, onAdd }: { connected: boolean; /** The Zotero account's name. */ account: string; onConnect: () => void; sources: Source[]; onAdd: (pick: ZoteroPick) => void }) {
  const [at, setAt] = useState(ZOTERO[0]!.id);
  const [inside, setInside] = useState<string>();
  const [find, setFind] = useState("");
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<"name" | "papers">("name");
  const [deep, setDeep] = useState(true);
  const [picking, setPicking] = useState(false);
  const deepId = useId();

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border bg-card px-6 py-7 text-center">
        <p className="text-sm font-medium">Zotero isn&apos;t connected</p>
        <p className="text-xs text-muted-foreground">Connect it to pick from your library and the groups you are in.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onConnect}><ZoteroIcon />Connect Zotero</Button>
      </div>
    );
  }

  const library = ZOTERO.find((one) => one.id === at)!;
  const here = library.collections.find((one) => one.key === inside);
  const words = find.trim().toLowerCase();
  const count = (one: ZoteroCollection) => (deep ? zoteroDeep(library, one) : one.papers);
  // A search looks through every level under where the list stands.
  const listed = (words ? (here ? zoteroUnder(library, here.key) : library.collections).filter((one) => one.name.toLowerCase().includes(words)) : zoteroInside(library, inside)).sort(
    (a, b) => (order === "papers" ? count(b) - count(a) : 0) || a.name.localeCompare(b.name, "en", { numeric: true }),
  );
  const pager = pagerOf(listed.length, PAGE, page, setPage);
  const go = (key?: string) => { setInside(key); setFind(""); setPage(1); };
  const LibraryIcon = libraryIcon(library);
  const option = (one: ZoteroLibrary) => {
    const Icon = libraryIcon(one);
    return (
      <CommandItem key={one.id} value={one.name} onSelect={() => { setAt(one.id); setPicking(false); go(); }} className="gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{one.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{plural(one.papers, "paper", "papers")}</span>
        {one.id === at ? <Check className="size-4 shrink-0 text-primary" /> : null}
      </CommandItem>
    );
  };
  const refOf = (one?: ZoteroCollection) => `zotero:${library.id}${one ? `:${one.key}` : ""}`;
  const added = (one?: ZoteroCollection) => sources.some((source) => source.ref === refOf(one));
  const add = (one: ZoteroCollection) => {
    const under = zoteroUnder(library, one.key).length;
    const path = zoteroPath(library, one);
    onAdd({ ref: refOf(one), name: one.name, detail: `In ${library.name}`, total: count(one), filters: [library.name, ...(path.length ? [`In ${inWords(path)}`] : []), ...(deep && under ? [`With ${plural(under, "sub-collection", "sub-collections")}`] : [])], abstracts: library.abstracts });
  };
  const step = "rounded-sm underline decoration-foreground/25 underline-offset-2 outline-none transition-colors hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <div className="space-y-2">
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={picking} aria-label="Zotero library" className="h-9 w-full min-w-0 justify-between gap-3 bg-card px-3 font-normal">
            <span className="flex min-w-0 items-center gap-2"><LibraryIcon className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{library.name}</span></span>
            <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">{plural(library.papers, "paper", "papers")}<ChevronsUpDown className="size-3.5" /></span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label="Zotero library" className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandInput placeholder="Find a library or a group" />
            <CommandList className="max-h-72">
              <CommandEmpty>No library or group by that name.</CommandEmpty>
              <CommandGroup heading="Yours">{ZOTERO.filter((one) => !one.group).map(option)}</CommandGroup>
              <CommandGroup heading="Groups">{ZOTERO.filter((one) => one.group).map(option)}</CommandGroup>
            </CommandList>
          </Command>
          <p className="flex items-center justify-between gap-3 border-t border-border-subtle px-3 py-2 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5"><ZoteroIcon className="size-3.5 shrink-0" /><span className="truncate">Connected as {account}</span></span>
            <NextLink href="/settings/connections" className={cn(INLINE_LINK, "shrink-0")}>Connections</NextLink>
          </p>
        </PopoverContent>
      </Popover>
      {/* The tools for a list of collections are there where there is one: a library with none offers only itself, and one whose collections hold no others has nothing to include. */}
      {library.collections.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={find} onChange={(event) => { setFind(event.target.value); setPage(1); }} placeholder={here ? `Find a collection in ${here.name}` : "Find a collection"} aria-label={`Find a collection in ${here?.name ?? library.name}`} className="h-8 rounded-full bg-card ps-8 text-sm" />
          </div>
          <Segmented label="Order" className="bg-card" value={order} onChange={(next) => { setOrder(next); setPage(1); }} options={[{ id: "name" as const, label: "Name" }, { id: "papers" as const, label: "Most papers" }]} />
          {library.collections.some((one) => one.parent) ? (
            <span className="flex shrink-0 items-center gap-1">
              <label htmlFor={deepId} className="flex items-center gap-2 text-xs font-medium"><Switch id={deepId} checked={deep} onCheckedChange={setDeep} />Include sub-collections</label>
              <Help title="Sub-collections" facts={<HelpFact>A paper filed in two of them is taken once</HelpFact>}>Zotero counts only the papers filed directly in a collection. With this on, a collection is added with the papers of every collection under it, and its count here takes them in.</Help>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="divide-y divide-border-subtle">
        {/* Where the list stands: all of the library, or the collection opened from it with the steps that lead back up. It can be added as it is. */}
        {here ? (
          <OfferRow
            offer={{ name: here.name, detail: "", total: count(here) }}
            icon={Folder}
            trail={
              <FadeRow scrolls scrollbar="none" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <button type="button" onClick={() => go()} className={cn(step, "shrink-0")}>{library.name}</button>
                {zoteroPath(library, here).map((one) => (
                  <span key={one.key} className="flex shrink-0 items-center gap-1"><ChevronRight aria-hidden className="size-3" /><button type="button" onClick={() => go(one.key)} className={step}>{one.name}</button></span>
                ))}
              </FadeRow>
            }
            added={added(here)}
            onAdd={() => add(here)}
          />
        ) : (
          <OfferRow
            offer={{ name: `Every paper in ${library.name}`, detail: library.loose && library.collections.length ? `${num(library.loose)} of them in no collection` : library.group ? "Zotero group" : "Your Zotero library", total: library.papers }}
            icon={Library}
            added={added()}
            onAdd={() => onAdd({ ref: refOf(), name: library.name, detail: library.group ? "Zotero group" : "Your Zotero library", total: library.papers, filters: ["Whole library"], abstracts: library.abstracts })}
          />
        )}
        <div className="divide-y divide-border-subtle" style={{ minHeight: pager.pages > 1 ? PAGE * ROW : undefined }}>
          {listed.slice((pager.page - 1) * PAGE, pager.page * PAGE).map((one) => {
            const under = zoteroUnder(library, one.key).length;
            // A search's results sit at any depth: each says where, from the place the list stands.
            const path = zoteroPath(library, one).filter((above) => !here || zoteroUnder(library, here.key).includes(above));
            return (
              <OfferRow
                key={one.key}
                offer={{ name: one.name, detail: words && path.length ? `In ${inWords(path)}` : under ? plural(under, "sub-collection", "sub-collections") : "", total: count(one) }}
                icon={Folder}
                added={added(one)}
                onOpen={under ? () => go(one.key) : undefined}
                onAdd={() => add(one)}
              />
            );
          })}
          {!listed.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{words ? `No collection by that name in ${here?.name ?? library.name}.` : `${library.name} has no collections.`}</p> : null}
        </div>
      </div>
      {pager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={pager.page} totalPages={pager.pages} onPageChange={setPage} totalItems={listed.length} itemsPerPage={PAGE} itemLabel="collections" /> : null}
    </div>
  );
}

type Missed = { none: number; bare: number; blank: number };
/** A box to paste DOIs into, in any form, and the button that looks them up. A lookup that brings nothing leaves what was pasted and says why under the box: how many don't exist, have no record or have no abstract, or that the same DOIs are a source already. */
export function DoiTab({ onLookUp }: { /** Null when some can be screened; else how many don't exist (`none`), how many exist with no record (`bare`) and how many have a record with no abstract (`blank`). */ onLookUp: (dois: string[]) => Missed | "twice" | null }) {
  const [text, setText] = useState("");
  const [missed, setMissed] = useState<Missed | "twice" | null>(null);
  const { dois, repeats } = doisIn(text);
  return (
    <div className="space-y-2">
      <span className="flex items-center gap-1">
        <label htmlFor="dois" className="text-xs font-medium text-muted-foreground">DOIs</label>
        <Help title="Pasted DOIs" facts={<><HelpFact>Bare, as doi.org addresses, or inside a reference list</HelpFact><HelpFact>A DOI pasted twice is looked up once</HelpFact></>}>Openscholar looks each DOI up in its index, then with Crossref and DataCite, which issue DOIs, and takes the title and the abstract from the first that has them. The ones it can&apos;t find, and the ones whose record has no abstract, are left out and listed on the source&apos;s row, to copy and check.</Help>
      </span>
      <Textarea id="dois" value={text} onChange={(event) => { setText(event.target.value); setMissed(null); }} rows={5} aria-invalid={Boolean(missed) || undefined} placeholder="Paste DOIs, or any text that holds them" className="bg-card text-sm" />
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex flex-wrap items-center gap-1.5">
          {missed === "twice" ? (
            <StateChip tone="warning" icon={TriangleAlert}>{dois.length === 1 ? "This DOI is already a source" : "These DOIs are already a source"}</StateChip>
          ) : missed ? (
            // Why none became a paper, as the list on a source's row would say it.
            <>
              {missed.none ? <StateChip tone="destructive" icon={TriangleAlert}>{missed.none === 1 ? "1 DOI doesn't exist" : `${num(missed.none)} DOIs don't exist`}</StateChip> : null}
              {missed.bare ? <StateChip tone="destructive" icon={TriangleAlert}>{missed.bare === 1 ? "1 DOI has no record" : `${num(missed.bare)} DOIs have no record`}</StateChip> : null}
              {missed.blank ? <StateChip tone="destructive" icon={TriangleAlert}>{missed.blank === 1 ? "1 paper has no abstract" : `${num(missed.blank)} papers have no abstract`}</StateChip> : null}
            </>
          ) : dois.length ? (
            <Chip icon={Hash}>{plural(dois.length, "DOI", "DOIs")}</Chip>
          ) : text.trim() ? (
            <StateChip tone="warning" icon={TriangleAlert}>No DOI in what you pasted</StateChip>
          ) : null}
          {repeats && !missed ? <Chip>{num(repeats)} pasted more than once</Chip> : null}
        </span>
        <Button variant="outline" size="sm" className="ms-auto" disabled={!dois.length} onClick={() => { const none = onLookUp(dois); if (none) setMissed(none); else setText(""); }}><Plus />Look up {dois.length ? plural(dois.length, "DOI", "DOIs") : "DOIs"}</Button>
      </div>
    </div>
  );
}

/** A table that was read and can't be added yet: which of its columns holds the title, and which the abstract, is for a person to say. */
export type PendingTable = { name: string; /** What it reads, which tells two files of one name apart. */ ref: string; table: TableRead; picked: TableRead["picked"]; /** Add was pressed with no title column picked. */ untitled?: boolean };
const NONE = "-";

/** The row a table waits in until its columns are named. Under each choice is what the first record holds in that column, to check the pick against. */
export function ColumnMatch({ pending, onPick, onAdd, onRemove }: { pending: PendingTable; onPick: (key: ColumnKey, head: string | undefined) => void; onAdd: () => void; onRemove: () => void }) {
  const id = useId();
  const { table, picked } = pending;
  const counts = tableCounts(table, picked);
  const first = table.rows[0] ?? {};
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex min-h-9 items-center gap-3 max-sm:flex-wrap">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground"><FileSpreadsheet className="size-4" /></span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium max-sm:basis-[calc(100%-3rem)]">{pending.name}</p>
        <StateChip tone="warning" icon={TriangleAlert}>Its columns need naming</StateChip>
        <TooltipHint label={`Remove ${pending.name}`}><Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground max-sm:ms-auto" aria-label={`Remove ${pending.name}`} onClick={onRemove}><Trash2 /></Button></TooltipHint>
      </div>
      <div className="space-y-3 ps-12 max-sm:ps-0">
        <p className="text-xs text-muted-foreground">Pick the column that holds each part. Under it is what the first of its {plural(table.rows.length, "row", "rows")} has there.</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
          {COLUMN_KEYS.map((key) => {
            const missing = key === "title" && pending.untitled && !picked.title;
            return (
              <div key={key} className="min-w-0 space-y-1">
                <label htmlFor={`${id}-${key}`} className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{COLUMN_LABEL[key]}{key === "title" ? <RequiredMark /> : null}</label>
                <Select value={picked[key] ?? (key === "title" ? "" : NONE)} onValueChange={(next) => onPick(key, next === NONE ? undefined : next)}>
                  <SelectTrigger id={`${id}-${key}`} aria-invalid={missing || undefined} className="h-9 w-full min-w-0 bg-card"><SelectValue placeholder="Pick a column" /></SelectTrigger>
                  <SelectContent>
                    {key === "title" ? null : <SelectItem value={NONE}>Not in this file</SelectItem>}
                    {table.heads.map((head) => <SelectItem key={head} value={head}>{head}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* The problem sits under the field it is about, in the line the sample has. */}
                {missing ? <p role="alert" className="h-4 truncate text-xs text-destructive">Pick the column that holds the title</p> : <p className="h-4 truncate text-xs text-muted-foreground">{picked[key] ? first[picked[key]!] : null}</p>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex flex-wrap gap-1.5">
            {counts.untitled.length ? <Chip>{plural(counts.untitled.length, "row", "rows")} without a title left out</Chip> : null}
            {picked.title && counts.bare.length ? <StateChip tone="warning">{num(counts.bare.length)} without an abstract</StateChip> : null}
          </span>
          <Button size="sm" className="ms-auto" onClick={onAdd}><Plus />Add {picked.title ? plural(counts.records, "record", "records") : "its records"}</Button>
        </div>
      </div>
    </div>
  );
}

/** One thing a source held, as its list shows it: what it is, what it was told as or why it isn't taken, and what can be done about it. */
export type ItemRow = { key: string; name: string; detail?: string; chip: string; tone: Tone; icon?: AppIcon; /** Which of the list's kinds it is, where the list can be narrowed to one. */ kind?: string; action?: ReactNode };

/**
 * What a source held, a page at a time: the DOIs or records it left out and why, or a PDF source's
 * files, each as it was told. Where the rows are of more than one kind the list narrows to one, and
 * what it shows can be copied.
 */
export function SourceItems({ rows, more, label, kinds, start, copied, help }: { rows: ItemRow[]; /** Rows after the named ones that are made only as their page is shown: a source can leave out tens of thousands. */ more?: { count: number; at: (place: number) => ItemRow }; /** What the rows are, as the count under the list names them: "files". */ label: string; kinds?: Array<{ id: string; label: string }>; /** The kind it opens on. */ start?: string; /** What the copied lines are called: with it, the list can be copied. */ copied?: [one: string, many: string]; help?: ReactNode }) {
  const [kind, setKind] = useState(start ?? "all");
  const [page, setPage] = useState(1);
  const of = (id: string) => (id === "all" ? rows : rows.filter((row) => row.kind === id));
  const listed = of(kind);
  const total = listed.length + (more?.count ?? 0);
  const pager = pagerOf(total, PAGE, page, setPage);
  const shown = Array.from({ length: Math.min(PAGE, total - (pager.page - 1) * PAGE) }, (_, at) => { const place = (pager.page - 1) * PAGE + at; return listed[place] ?? more!.at(place - listed.length); });
  const copy = () => void navigator.clipboard.writeText(listed.map((row) => row.name).join("\n")).then(() => toast(`Copied ${plural(listed.length, copied![0], copied![1])}`));
  return (
    <div className="space-y-2">
      {kinds || copied || help ? (
        <div className="flex flex-wrap items-center gap-2">
          {kinds ? <Segmented label="Show" className="bg-card" value={kind} onChange={(next) => { setKind(next); setPage(1); }} options={[{ id: "all", label: "All", detail: num(rows.length) }, ...kinds.map((one) => ({ ...one, detail: num(of(one.id).length) }))]} /> : null}
          {help}
          {copied ? <Button variant="ghost" size="sm" className="ms-auto h-8 text-xs text-muted-foreground" disabled={!listed.length} onClick={copy}><Copy />Copy the list</Button> : null}
        </div>
      ) : null}
      <ul className="divide-y divide-border-subtle" style={{ minHeight: pager.pages > 1 ? PAGE * 45 : undefined }}>
        {shown.map((row) => (
          <li key={row.key} className="flex min-h-11 items-center gap-x-3 gap-y-1 py-1.5 max-sm:flex-wrap">
            <div className="min-w-0 flex-1 max-sm:basis-full">
              <p className="truncate text-sm">{row.name}</p>
              {row.detail ? <p className="truncate text-xs text-muted-foreground">{row.detail}</p> : null}
            </div>
            <StateChip tone={row.tone} icon={row.icon}>{row.chip}</StateChip>
            {row.action}
          </li>
        ))}
        {!total ? <li className="py-5 text-center text-sm text-muted-foreground">None.</li> : null}
      </ul>
      {pager.pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={pager.page} totalPages={pager.pages} onPageChange={setPage} totalItems={total} itemsPerPage={PAGE} itemLabel={label} /> : null}
    </div>
  );
}

/** The button on a matched PDF that sets its match aside, and takes that back. */
export function WrongPaper({ wrong, onToggle, name }: { wrong: boolean; onToggle: () => void; name: string }) {
  return wrong ? (
    <Button variant="ghost" size="sm" className="h-8 shrink-0 text-xs" aria-label={`Take the match back for ${name}`} onClick={onToggle}><Undo2 />Undo</Button>
  ) : (
    <Button variant="ghost" size="sm" className="h-8 shrink-0 text-xs text-muted-foreground" aria-label={`${name} is not this paper`} onClick={onToggle}>Not this paper</Button>
  );
}
