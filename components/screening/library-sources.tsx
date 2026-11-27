"use client";

// An Evidence Library's records as a source (plans/evidence-library-sources), listed as screening
// and extraction list their other sources. A library the person reads is picked at the top, its
// whole set of records, their own collections, the ones shared with them and the library's own
// collections are rows under it; and the address of any library OpenScholar runs, pasted beside the
// picker, becomes a row of its own: a search, a collection, someone's collection or a record.

import { SEARCH_PILL } from "./pieces";
import { FadeRow } from "@/components/ui/fade-row";
import { useState, type ClipboardEvent, type ReactNode } from "react";
import { preload } from "react-dom";
import useSWR from "swr";
import { useAuth } from "@clerk/nextjs";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CountryFlag } from "@/components/ui/country-flag";
import { countryCodeOf, getRegionDisplayName } from "@/lib/i18n/region-names";
import { ArrowUpDown, Building2, CalendarDays, EvidenceLibrariesIcon, Eye, FileText, Folder, Globe, Link2, ListChecks, Lock, Pencil, Search, TopicsIcon, TriangleAlert, UserRound, type AppIcon } from "@/components/icons";
import { LibraryImage } from "@/components/evidence-libraries/library-image";
import { ListRowsSkeleton, ListSearch } from "@/components/evidence-libraries/list-controls";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { AutoHeight } from "@/components/ui/auto-height";
import { faceOf } from "@/components/workspaces/run-by";
import { EASE } from "@/components/settings/model-map";
import { LIST } from "@/components/settings/parts";
import { PageStepper } from "@/components/shared/page-stepper";
import { Input } from "@/components/ui/input";
import { Pills } from "@/components/ui/pills";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { filtersOf, rowKey, type FilterKind, type HeldRow, type LibraryContents, type LibraryRow, type ReaderLibrary } from "@/lib/evidence-libraries/reader-sources";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace, useWorkspaceAction } from "@/lib/workspaces/url";
import { Chip } from "./parts";
import { SourceRow } from "./source-row";

type Filter = "all" | "yours" | "shared" | "library";
/** Rows one page of the list holds, and a row's height with the line under it, as the other kinds' lists. */
const PAGE = 5;
const ROW = 57;

/**
 * The libraries the person reads and what each lists for them, and where the list is: the library, the filter, the
 * words, the page, and the sources held outside the lists: the ones the form `opened` with, and the ones pasted.
 * Kept by the form, so switching kinds keeps it. The libraries read and the ones the form opened on are read with the
 * rest of the form, so switching to them moves nothing; a library reached by a pasted address is read before its row
 * shows, so its list comes with it.
 */
export function useLibrarySources(opened: HeldRow[] = [], { settled = true }: { settled?: boolean } = {}) {
  const workspaceId = useWorkspace();
  // What a library lists is the person's own: it is kept under who they are, and never shown to someone signed in after them.
  const { userId } = useAuth();
  const { data: listed } = useProtectedQuery(api.evidenceLibraries.readers.list, inWorkspace(workspaceId, {}));
  const read = useWorkspaceAction(api.evidenceLibraries.library.sources);
  const [pasted, setPasted] = useState<Array<{ held: HeldRow; contents: LibraryContents | null }>>([]);
  const held = [...pasted.map((one) => one.held), ...opened.filter((one) => !pasted.some((other) => rowKey(other.held.row) === rowKey(one.row)))];
  // The libraries of the sources the form opened with are read with the rest, once the form knows them (`settled`: a
  // hand-off's source comes after the form opens), so they list when it shows; one held later was read when it was pasted.
  const [openedOn, setOpenedOn] = useState(() => (settled ? opened.map((one) => one.library.libraryId) : null));
  if (openedOn === null && settled) setOpenedOn(opened.map((one) => one.library.libraryId));
  // Asked for by which libraries they are, not the order the list has them in, which opening a hand-off changes.
  const ids = listed && openedOn && [...new Set([...listed.map((library) => library.libraryId), ...openedOn])].toSorted();
  const known = useSWR(workspaceId && userId && ids ? ["library-sources", userId, ...ids] : null, () => (ids!.length ? read({ libraryIds: ids! }) : []), { revalidateOnFocus: false });
  // A library that didn't answer is one that couldn't list; the form doesn't wait on it again.
  const failed = (libraryId: string) => ({ libraryId, rows: null, problem: "unreadable" as const }) as LibraryContents;
  const listedContents = known.data ?? (known.error ? (ids ?? []).map(failed) : []);
  const contents = [...listedContents, ...pasted.flatMap((one) => (one.contents && !listedContents.some((other) => other.libraryId === one.contents!.libraryId) ? [one.contents] : []))];
  // The owners' photos are fetched with the lists, so their faces are there when the list first shows.
  for (const row of contents.flatMap((one) => one.rows ?? [])) if (row.owner?.image) preload(row.owner.image, { as: "image" });
  const libraries: ReaderLibrary[] = [...(listed ?? []), ...held.filter((one, at) => !listed?.some((library) => library.libraryId === one.library.libraryId) && held.findIndex((other) => other.library.libraryId === one.library.libraryId) === at).map(({ library }) => ({ ...library, ways: [], role: null }))];
  const [picked, setLibraryId] = useState<string | null>(null);
  // The library picked, else the one the form opened on, else the first.
  const library = libraries.find((one) => one.libraryId === (picked ?? opened[0]?.library.libraryId)) ?? libraries[0];
  const [filter, setFilter] = useState<Filter>("all");
  const [words, setWords] = useState("");
  const [page, setPage] = useState(1);
  return {
    libraries,
    contents,
    // Which libraries the person reads: a query, there with the rest of the form. What each lists is read from the libraries themselves, which can take seconds.
    librariesKnown: listed !== undefined,
    loaded: listed !== undefined && openedOn !== null && (known.data !== undefined || known.error !== undefined),
    library,
    setLibraryId,
    filter,
    setFilter,
    words,
    setWords,
    page,
    setPage,
    held,
    /**
     * Holds a source, once, first of its library's, once the list of a library not read yet has come. A reader's
     * collection its library's list doesn't have, shared with them since that was read, reads the list again.
     */
    hold: async (one: HeldRow) => {
      const libraryId = one.library.libraryId;
      const listed = contents.find((other) => other.libraryId === libraryId);
      const stale = listed !== undefined && "readerCollection" in one.row.source && !listed.rows?.some((row) => rowKey(row) === rowKey(one.row));
      const reread = listed && !stale ? null : ((await read({ libraryIds: [libraryId] }).catch(() => null))?.[0] ?? null);
      // A library already listed takes the newer list in its place, where later reads of the list replace it in turn.
      if (listed && reread) void known.mutate((all) => all?.map((other) => (other.libraryId === libraryId ? reread : other)), { revalidate: false });
      const listing = listed ? null : (reread ?? failed(libraryId));
      setPasted((rows) => [{ held: one, contents: listing ?? rows.find((other) => other.held.library.libraryId === libraryId)?.contents ?? null }, ...rows.filter((other) => rowKey(other.held.row) !== rowKey(one.row))]);
    },
  };
}
export type LibrarySourceState = ReturnType<typeof useLibrarySources>;

/** A library's own image in a row's icon place. One component per image, so a row doesn't remount as it renders again. */
const MARKS = new Map<string, AppIcon>();
export function libraryMark(faviconUrl: string | null): AppIcon {
  const key = faviconUrl ?? "";
  let mark = MARKS.get(key);
  if (!mark) {
    mark = function LibraryMark({ className }: { className?: string }) {
      const fallback = <EvidenceLibrariesIcon className={className} />;
      return faviconUrl ? <LibraryImage src={faviconUrl} className={cn("flex items-center justify-center", className)} imageClassName="size-full rounded-sm object-contain" fallback={fallback} /> : fallback;
    };
    MARKS.set(key, mark);
  }
  return mark;
}

/**
 * A collection owner's photo in a row's icon place, drawn at once: the shared avatar shows its icon for
 * a frame before even a photo already fetched (Radix Avatar), and the photos are fetched with the list.
 */
const PORTRAIT_MARKS = new Map<string, AppIcon>();
function portrait(url: string): AppIcon {
  let mark = PORTRAIT_MARKS.get(url);
  if (!mark) {
    mark = function Portrait() {
      // eslint-disable-next-line @next/next/no-img-element -- a person's photo from their library account, any host
      return <img src={url} alt="" className="size-5 rounded-full bg-muted object-cover" />;
    };
    PORTRAIT_MARKS.set(url, mark);
  }
  return mark;
}

const ICON: Record<LibraryRow["what"], AppIcon> = { all: EvidenceLibrariesIcon, yours: Folder, shared: Folder, other: Folder, library: Folder, search: Search, records: FileText };

/** A row's icon: the library's own image for all of it, the owner's face for someone else's collection. */
export function rowIcon(row: LibraryRow, libraries: Array<Pick<ReaderLibrary, "libraryId" | "faviconUrl">>): AppIcon {
  if (row.what === "all") return libraryMark(libraries.find((library) => library.libraryId === row.libraryId)?.faviconUrl ?? null);
  if (row.owner) return row.owner.image ? portrait(row.owner.image) : faceOf({ name: row.owner.name });
  return ICON[row.what];
}

/** A row's name: all of a library is every record in it, a search with no words all its records, records a library handed over the records from it. */
export function useRowLabel() {
  const t = useTranslations("librarySources");
  return (row: LibraryRow) =>
    row.what === "search" ? row.label || t("allRecords") : row.what === "all" ? t("everyRecord", { library: row.label }) : row.what === "records" && "records" in row.source && row.source.records.length > 1 ? t("recordsFrom", { library: row.label }) : row.label;
}

/** Picks one of the person's libraries: each by its mark and name, with their role there and how many records it holds. */
export function LibrarySelect({ libraries, value, onChange, totalOf }: { libraries: ReaderLibrary[]; value: string; onChange: (libraryId: string) => void; totalOf?: (libraryId: string) => number | undefined }) {
  const t = useTranslations("librarySources");
  const format = useFormatter();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={t("library")} size="sm" className="w-full min-w-0 rounded-full px-3.5 text-xs sm:w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {libraries.map((one) => {
          const Mark = libraryMark(one.faviconUrl);
          const total = totalOf?.(one.libraryId);
          return (
            <SelectItem key={one.libraryId} value={one.libraryId}>
              <Mark className="size-4" />
              <span className="truncate">{one.name}</span>
              <span className="ms-auto flex items-center gap-1.5 ps-2 text-xs tabular-nums text-muted-foreground">
                {one.role ? <Chip className="h-5 px-1.5">{t(`role.${one.role}`)}</Chip> : null}
                {total === undefined ? null : format.number(total, { notation: "compact" })}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function LibrarySources({
  state,
  many = false,
  isOn,
  onToggle,
  onPasted,
  scope,
}: {
  state: LibrarySourceState;
  /** Extraction takes any number of sources; screening one. */
  many?: boolean;
  isOn: (row: LibraryRow) => boolean;
  onToggle: (row: LibraryRow, library: HeldRow["library"]) => void;
  /** A pasted address became this row: the form picks it. */
  onPasted: (held: HeldRow) => void;
  /** What opens under a picked row: how many of its records to read. */
  scope: (row: LibraryRow) => ReactNode;
}) {
  const t = useTranslations("librarySources");
  const ts = useTranslations("screeningPage");
  const tc = useTranslations("common");
  const labelOf = useRowLabel();
  const resolveAddress = useWorkspaceAction(api.evidenceLibraries.library.address);
  const { libraries, library, contents, filter, setFilter, words, setWords, page, setPage, held } = state;
  const [address, setAddress] = useState("");
  const [resolving, setResolving] = useState(false);
  const [pasteProblem, setProblem] = useState<string | null>(null);
  const problem = pasteProblem;

  const read = library ? contents.find((one) => one.libraryId === library.libraryId) : undefined;
  const listed = read?.rows ?? [];
  const here = held.filter((one) => one.row.libraryId === library?.libraryId).map((one) => one.row);
  const lists: Record<Filter, LibraryRow[]> = {
    yours: listed.filter((row) => row.what === "yours"),
    shared: listed.filter((row) => row.what === "shared"),
    library: listed.filter((row) => row.what === "library"),
    all: [...here, ...listed.filter((row) => !here.some((one) => rowKey(one) === rowKey(row)))],
  };
  const needle = words.trim().toLowerCase();
  const rows = needle ? lists[filter].filter((row) => labelOf(row).toLowerCase().includes(needle)) : lists[filter];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages);
  const shown = rows.slice((at - 1) * PAGE, at * PAGE);
  const totalOf = (libraryId: string) => contents.find((one) => one.libraryId === libraryId)?.rows?.find((row) => row.what === "all")?.records;

  const pick = (id: string) => {
    state.setLibraryId(id);
    setPage(1);
  };
  const resolve = async (text: string) => {
    if (!text.trim() || resolving) return;
    setResolving(true);
    setProblem(null);
    try {
      const found = await resolveAddress({ address: text.trim() });
      if ("error" in found) return setProblem(t(`error.${found.error}`));
      // A pasted row leads its library's list, once, and is picked.
      const one = { library: found.library, row: found.row };
      await state.hold(one);
      state.setLibraryId(found.row.libraryId);
      setFilter("all");
      setWords("");
      setPage(1);
      setAddress("");
      onPasted(one);
    } catch {
      setProblem(t("error.unreadable"));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {/* Before the libraries the person reads are known, the picker's place is held. */}
        {library ? <LibrarySelect libraries={libraries} value={library.libraryId} onChange={pick} totalOf={totalOf} /> : state.librariesKnown ? null : <SkeletonBar className="h-8 w-full shrink-0 rounded-full sm:w-64" />}
        <div className="relative min-w-[min(14rem,100%)] flex-1">
          <Link2 aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setProblem(null);
            }}
            // One address at a time: the field waits for the one being read.
            readOnly={resolving}
            onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
              if (resolving) return e.preventDefault();
              const text = e.clipboardData.getData("text");
              if (/^https?:\/\//i.test(text.trim())) {
                e.preventDefault();
                setAddress(text.trim());
                void resolve(text);
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && void resolve(address)}
            placeholder={t("address")}
            aria-label={t("address")}
            aria-invalid={pasteProblem ? true : undefined}
            className="h-8 rounded-full bg-card ps-8 pe-8 text-sm"
          />
          {resolving ? <Spinner className="absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /> : null}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {problem ? (
          <motion.p key="problem" role="alert" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden">
            <span className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" />
              {problem}
            </span>
          </motion.p>
        ) : null}
      </AnimatePresence>

      {library || !state.librariesKnown ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Pills
              label={t("show")}
              value={filter}
              onChange={(next) => {
                setFilter(next);
                setPage(1);
              }}
              options={(["all", "yours", "shared", "library"] as const).map((id) => ({ id, label: t(`filter.${id}`) }))}
            />
            <ListSearch
              box="min-w-40 flex-1"
              value={words}
              onChange={(e) => {
                setWords(e.target.value);
                setPage(1);
              }}
              placeholder={t("find")}
              aria-label={t("find")}
              className={SEARCH_PILL}
            />
          </div>

          {/* A full page's height while there are pages, so the pager stays put on a short last page; its rows take the place of the placeholder rows when the library answers after the tab opened. */}
          <AutoHeight>
          <div style={pages > 1 ? { minHeight: PAGE * ROW + 1 } : undefined}>
            {!state.loaded || !library ? (
              <ListRowsSkeleton rows={PAGE} height={ROW} label={tc("loading")} className={LIST} />
            ) : read?.problem && !(filter === "all" && here.length) ? (
              <p className={cn(LIST, "px-4 py-6 text-center text-sm text-muted-foreground")}>{t(read.problem === "outdated" ? "outdated" : "unread", { library: library.name })}</p>
            ) : shown.length === 0 ? (
              <p className={cn(LIST, "px-4 py-6 text-center text-sm text-muted-foreground")}>{needle ? t("empty.found") : t(`empty.${filter}`, { library: library.name })}</p>
            ) : (
              <div className={LIST} role={many ? "group" : "radiogroup"} aria-label={t("kind")}>
                {shown.map((row) => (
                  <SourceRow
                    key={rowKey(row)}
                    many={many}
                    on={isOn(row)}
                    onToggle={() => onToggle(row, library)}
                    disabled={row.records === 0}
                    icon={rowIcon(row, libraries)}
                    label={labelOf(row)}
                    detail={<RowFacts row={row} pasted={here.some((one) => rowKey(one) === rowKey(row))} address={library.address} />}
                    count={<Chip>{ts("paperCount", { count: row.records })}</Chip>}
                  >
                    {scope(row)}
                  </SourceRow>
                ))}
              </div>
            )}
          </div>
          </AutoHeight>
          {/* Paged as the other source tabs are, with the range it shows and how many there are. */}
          {pages > 1 ? <CommandCenterPagination className="pt-1" currentPage={at} itemLabel={t("pagerItems")} steps={{ canPrevious: at > 1, canNext: at < pages, onPrevious: () => setPage(at - 1), onNext: () => setPage(at + 1), offset: (at - 1) * PAGE, shown: shown.length, total: rows.length, pageCount: pages }} /> : null}
        </>
      ) : (
        <p className={cn(LIST, "px-4 py-6 text-center text-sm text-muted-foreground")}>{ts("noSets.evidenceLibrary")}</p>
      )}
    </div>
  );
}

/** Each filter of a library search by its icon, as the search page's own chips tell them apart. */
const FILTER_ICON: Record<FilterKind, AppIcon> = { range: CalendarDays, type: FileText, topics: TopicsIcon, institution: Building2, country: Globe, author: UserRound, collections: Folder, study: ListChecks, sort: ArrowUpDown };

/** One filter of a saved community search: its kind's icon, or a country's flag, then its value. */
function FilterChip({ kind, value }: { kind: FilterKind; value: string }) {
  const t = useTranslations("librarySources");
  const locale = useLocale();
  // A community saves a place as its path, "Africa > Eastern Africa > KE"; a country ends it, a region doesn't.
  const country = kind === "country" ? countryCodeOf(value.split(">").at(-1)) : null;
  if (country) return <Chip><CountryFlag countryCode={country} className="shrink-0" />{getRegionDisplayName(country, locale)}</Chip>;
  return <Chip icon={FILTER_ICON[kind]}>{kind === "sort" ? t(`sort.${value}` as "sort.desc") : value}</Chip>;
}

/** What a row is, as chips on one line that scrolls sideways when crowded. */
export function RowFacts({ row, pasted, address }: { row: LibraryRow; pasted: boolean; address: string }) {
  const t = useTranslations("librarySources");
  const chips: ReactNode[] = [];
  if (pasted) chips.push(<Chip key="pasted" icon={Link2}>{t("fromAddress")}</Chip>);
  if (row.what === "all") chips.push(<Chip key="where" icon={Globe}>{address.replace(/^https?:\/\//, "").replace(/\/$/, "")}</Chip>);
  if (row.owner) chips.push(<Chip key="owner">{row.owner.name}</Chip>);
  if (row.access === "editor") chips.push(<Chip key="access" icon={Pencil}>{t("canEdit")}</Chip>);
  if (row.access === "viewer" && row.what !== "other") chips.push(<Chip key="access" icon={Eye}>{t("canView")}</Chip>);
  if (row.private !== undefined) chips.push(<Chip key="private" icon={row.private ? Lock : Globe}>{row.private ? t("private") : t("public")}</Chip>);
  if (row.parent) chips.push(<Chip key="parent" icon={Folder}>{t("in", { name: row.parent })}</Chip>);
  if ("search" in row.source) for (const { kind, value } of filtersOf(row.source.search)) chips.push(<FilterChip key={`${kind}:${value}`} kind={kind} value={value} />);
  if (!chips.length) return null;
  return (
    <FadeRow as="span" scrolls className="flex gap-1">
      {chips}
    </FadeRow>
  );
}
