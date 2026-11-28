"use client";

import { useMemo, useState } from "react";
import { createParser, useQueryState } from "nuqs";
import { useQueries } from "convex-helpers/react/cache/hooks";
import { getFunctionName, type FunctionReference, type PaginationResult, type paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer } from "convex/values";
import { useAuthReadiness } from "@/components/providers/convex-provider";

/** The page arguments a query declares with `paginationOptsValidator`, which carry an `id`. */
type PaginationOptions = Infer<typeof paginationOptsValidator>;
type PageQuery = FunctionReference<"query", "public", { paginationOpts: PaginationOptions }, PaginationResult<unknown>>;
type PageArgs<Query extends PageQuery> = Omit<Query["_args"], "paginationOpts">;
type PageItem<Query extends PageQuery> = Query["_returnType"]["page"][number];
type Read = { cursor: string | null; numItems: number };
type Result<Query extends PageQuery> = { page: PageItem<Query>[]; isDone: boolean; continueCursor: string };
type Shown<Query extends PageQuery> = Result<Query> & { key: string; list: string | undefined; number: number; offset: number; from: Result<Query>[] };
/** Where a page after the first starts, and how many rows the pages before it held. */
type Start = { cursor: string; offset: number };
/** The first page's place: one array, so a list at its first page is the same place on every draw. */
const NO_STARTS: Start[] = [];

/**
 * Reads one page may take to fill. A filtered query stops after a set number of rows, so
 * a sparse filter returns a short page that isn't the end, and the page reads on from
 * where it stopped. ponytail: past this many reads it shows what it found, and next
 * carries on from there; a server index per filter would fill a page in one read.
 */
const MAX_READS_PER_PAGE = 5;
/** Reads a page with nothing in it yet may take: an empty page that isn't the end says nothing, so it reads on further. */
const MAX_EMPTY_READS = 20;

/** Whether the server refused a read's cursor, the way Convex's own usePaginatedQuery recognizes it. */
const invalidCursor = (error: Error) =>
  error.message.includes("InvalidCursor") || (error instanceof ConvexError && (error.data as { paginationError?: unknown } | null)?.paginationError === "InvalidCursor");

/**
 * One page of a cursor-paged query, stepped with previous and next. It keeps the start
 * cursor of every page it passed, so it reads only the page shown, and starts over from
 * the first page when `args` or the page size change. The last page shown stays up until the next arrives.
 *
 * A live Convex page keeps the range it first read, so rows added inside it grow it past
 * what was asked; a grown page is read again from its start, under a new query id. Rows that
 * leave it shrink it, and it reads on past its end to stay full; once it is out of reads it is
 * read again from its start too, so a list a person works through never hides what is left. A page
 * can come back empty yet not be the end, when its reads found nothing; `canNext` says so.
 * A list that ends exactly on a full page finds that out from the empty page after it, and
 * stops offering next there until a row is added after it.
 */
/**
 * `open`: a query anyone may read, signed in or not, which doesn't wait for sign-in.
 * `list`: what makes it another list rather than another page, search or order of the same one, such as a tab or a
 * filter. While the rows up are of another list than the one asked for, `isOther` says so: a page shows skeletons
 * then, never the last list's rows under the new tab, and only dims rows of the same list (`isStale`).
 */
type Options = { open?: boolean; list?: string };
/** `scroll: false` for a list that is one part of a long page: its next page opens where the list is, not at the page's top. */
type PlacedOptions = Options & { scroll?: boolean };

/**
 * Where a list is: the number of the page shown, for the list those arguments and that page size make.
 * `of` names that list, so a place kept from another search, another size or another list is no place in this one.
 */
type Placed = { of: string; page: number };
/** Where a place is kept outside the list. A list that keeps its page to itself has none. */
type Place = { placed: Placed | null; setPlaced: (next: Placed | null) => void };

/** A short name for a list's query, arguments and page size, to tell one list's place from another's. */
function nameOf(text: string) {
  let hash = 5381;
  for (let at = 0; at < text.length; at++) hash = ((hash << 5) + hash + text.charCodeAt(at)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * A place in the address: the page's number, then the list's name. Never a cursor: a list read in a person's order
 * starts its pages at a name or an email address, which has no business in an address, a history or a page-view record.
 */
const parseAsPlaced = createParser<Placed>({
  parse: (value) => {
    const [number, of, ...rest] = value.split(".");
    const page = Number(number);
    return of && !rest.length && Number.isInteger(page) && page > 1 ? { of, page } : null;
  },
  serialize: ({ of, page }) => `${page}.${of}`,
  eq: (a, b) => a.of === b.of && a.page === b.page,
});

/** The list with its page kept in the component: for a picker, a dialog or a rail, whose paging is no place to come back to. */
export function useCursorPage<Query extends PageQuery>(query: Query, args: PageArgs<Query> | "skip", pageSize: number, options: Options = {}) {
  return usePages(null, query, args, pageSize, options);
}

/**
 * The same list with its page in the address, under `name` (OpenDevEd/openalex-count#1212): stepping forward or back
 * is a step in the browser's history, opened at its top as a numbered page is, so Back returns to the page before, and
 * a reload or a link lands on the same page, and on the list's last page when it has since grown shorter.
 */
export function useCursorPageAt<Query extends PageQuery>(name: string, query: Query, args: PageArgs<Query> | "skip", pageSize: number, { scroll = true, ...options }: PlacedOptions = {}) {
  const [placed, setPlaced] = useQueryState(name, parseAsPlaced.withOptions({ history: "push", scroll }));
  return usePages({ placed, setPlaced: (next) => void setPlaced(next) }, query, args, pageSize, options);
}

function usePages<Query extends PageQuery>(place: Place | null, query: Query, args: PageArgs<Query> | "skip", pageSize: number, { open = false, list }: Options) {
  const { canRunProtectedQueries } = useAuthReadiness();
  // A page of another size starts somewhere else, so the size is part of what the pages are of.
  const key = JSON.stringify([args, pageSize]);
  // Two lists on one page may share a parameter and take the same arguments: the query is part of which list it is.
  const of = nameOf(`${getFunctionName(query)} ${key}`);
  // How many pages the place is past the first: the starts it takes to read the page it names.
  const named = place ? (place.placed?.of === of ? place.placed.page - 1 : 0) : undefined;
  // `starts` holds where every page after the first starts; `reads`, the current page's reads.
  // `end` is where the list was found to end, by stepping to an empty page: the page before
  // it, and the cursor the empty page started at.
  // `want` is how many starts the page to show takes. It is the place's own, unless the list itself moved off it: a
  // cursor the server refused, a last page emptied by deletions, or a place past the list's end shows another page
  // than the place names until the next step names it. While `starts` is short of it, the pages between are read one
  // after another to find where the page starts. ponytail: a page far down a list, opened from a link or a reload,
  // costs a read for every page before it; a server that kept each page's start under the address's name would open
  // it in one.
  // `known` keeps every start found for this list, so Back to a page already passed reads it at once.
  const fresh = (placed: number, starts: Start[], known: Start[], want = placed) => ({
    key, placed, want, starts, known: starts.length > known.length || starts.some((start, i) => start.cursor !== known[i]!.cursor) ? starts : known,
    reads: [{ cursor: starts.at(-1)?.cursor ?? null, numItems: pageSize }] as Read[], id: 0, end: undefined as { page: number; cursor: string } | undefined,
    // How many rows the page held when it was last read again from its start for running out of reads.
    packed: undefined as number | undefined,
    // Where a full page that may be the list's last stops: one row past it is read, so next is offered only where there is one.
    peek: undefined as string | undefined,
    // What the last read past a full page found, kept while a moved one is read again: next neither blinks on nor holds the page.
    found: undefined as boolean | undefined,
  });
  const [state, setState] = useState(() => fresh(named ?? 0, NO_STARTS, NO_STARTS));
  // A list that keeps its page to itself keeps it here, for as long as it is the same list.
  const placed = named ?? (state.key === key ? state.placed : 0);
  const from = (starts: Start[], known: Start[], want = placed) => fresh(placed, starts, known, want);
  // When the list or its place changes, the reads start over from that place, with the starts this list already gave.
  const moved = state.key !== key || state.placed !== placed;
  const current = moved ? from(state.key === key ? state.known.slice(0, placed) : NO_STARTS, state.key === key ? state.known : NO_STARTS) : state;
  if (moved) setState(current);
  const { starts, reads, id, known, want, peek, found: foundBefore } = current;
  const ended = current.end?.page === starts.length ? current.end.cursor : undefined;

  const run = args !== "skip" && (open || canRunProtectedQueries);
  // useQueries subscribes again whenever its request object changes, so it changes only with the reads.
  const requests = useMemo(
    () => {
      if (!run) return {};
      const request = (read: Read) => ({ query, args: { ...args, paginationOpts: { ...read, id } } });
      const page = Object.fromEntries(reads.map((read, i) => [String(i), request(read)]));
      // On the page the list ended on, the read after it stays up, so next comes back when a row is added there.
      // After a full page, the read of one row past it says whether there is a next page before anyone steps to it.
      const past = ended ?? peek;
      return past === undefined ? page : { ...page, after: request({ cursor: past, numItems: 1 }) };
    },
    // `key` stands for `args`, and the name for `query`, whose `api.*` reference is a new object on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, getFunctionName(query), key, reads, id, ended, peek],
  );
  const results = useQueries(requests) as Record<string, Result<Query> | Error | undefined>;
  const read = reads.map((_, i) => results[String(i)]);
  const error = read.find((result) => result instanceof Error);
  // A deploy that reads the list through another index refuses every cursor from before it,
  // the end a first page's subscription keeps included, so the list starts over from its first
  // page under a new query id, as Convex's usePaginatedQuery does. Any other error is thrown.
  // The read past a full page that may be the last is only a look ahead: a cursor refused there offers next, and the page's own reads find the change.
  if ([...read, ...(ended !== undefined ? [results.after] : [])].some((result) => result instanceof Error && invalidCursor(result))) setState({ ...from(NO_STARTS, NO_STARTS, 0), id: id + 1 });
  else if (error) throw error;

  const [shown, setShown] = useState<Shown<Query> | undefined>(undefined);
  let data: Shown<Query> | undefined;
  if (args !== "skip" && !error && read.every((result) => result !== undefined)) {
    const from = read as Result<Query>[];
    const last = from[from.length - 1];
    const count = from.reduce((sum, result) => sum + result.page.length, 0);
    if (count > pageSize || from.some((result, i) => result.page.length > reads[i].numItems || (i + 1 < from.length && result.continueCursor !== reads[i + 1].cursor))) {
      // Live rows grew a read, rows added to an earlier read pushed the page past its size, or a
      // read now stops somewhere else than where the next one starts: read the page again from
      // its start, so no row falls between two reads or shows in both.
      // The page's own end moves with it, so where the list ended is found again.
      setState({ ...current, reads: [{ cursor: starts.at(-1)?.cursor ?? null, numItems: pageSize }], id: id + 1, end: undefined });
    } else if (count < pageSize && !last.isDone && reads.length < (count ? MAX_READS_PER_PAGE : MAX_EMPTY_READS)) {
      setState({ ...current, reads: [...reads, { cursor: last.continueCursor, numItems: pageSize - count }] });
    } else if (count < pageSize && !last.isDone && current.packed !== count) {
      // Out of reads, short, and not at the end. Where rows left the ranges its reads keep, as a queue's do while a
      // person works through it, the rows past its last read never reach it: it is read again from its start, which
      // they fill. A sparse filter leaves it as short as it was, and it is then shown as it is.
      setState({ ...current, reads: [{ cursor: starts.at(-1)?.cursor ?? null, numItems: pageSize }], id: id + 1, end: undefined, packed: count });
    } else if (shown?.key === key && shown.list === list && shown.number === starts.length + 1 && shown.from.length === from.length && shown.from.every((result, i) => result === from[i])) {
      data = shown;
    } else {
      const offset = starts.at(-1)?.offset ?? 0;
      data = { key, list, number: starts.length + 1, offset, from, page: from.flatMap((result) => result.page), isDone: last.isDone, continueCursor: last.continueCursor };
    }
  }

  // A step the person takes names the page it goes to, wherever the place is kept; the reads follow it at once.
  const step = (nextStarts: Start[]) => {
    setState({ ...fresh(nextStarts.length, nextStarts, known), id });
    place?.setPlaced(nextStarts.length ? { of, page: nextStarts.length + 1 } : null);
  };
  // An empty last page, after a list that ended on a full page or one emptied by deletions, steps
  // back to the page before it, the list's end. The list moved, not the person: the place keeps its name.
  const emptied = data !== undefined && data.page.length === 0 && data.isDone && starts.length > 0;
  // A page on the way to the one the place names: read on from where it stops, and show nothing of it.
  const passing = data !== undefined && !emptied && starts.length < want && !data.isDone;
  if (emptied) setState({ ...current, want: starts.length - 1, starts: starts.slice(0, -1), reads: [{ cursor: starts.at(-2)?.cursor ?? null, numItems: pageSize }], end: { page: starts.length - 1, cursor: starts[starts.length - 1].cursor } });
  else if (passing) setState({ ...from([...starts, { cursor: data!.continueCursor, offset: data!.offset + data!.page.length }], known, want), id });
  else if (data !== undefined) {
    // The list ends before the page the place names: this is the page to show, and it stays the one shown when rows
    // added after it make it no longer the last.
    if (starts.length < want) setState({ ...current, want: starts.length });
    if (data !== shown) setShown(data);
  }
  if (passing) data = undefined;
  const peekAt = data !== undefined && !data.isDone && data.page.length >= pageSize && ended === undefined ? data.continueCursor : undefined;
  if (data !== undefined && !emptied && peekAt !== peek) setState({ ...current, peek: peekAt });

  // Past the page the list ended on there is more once the read after it finds a row, or stops short of the end.
  const after = results.after;
  const found = after !== undefined && !(after instanceof Error) && (after.page.length > 0 || !after.isDone);
  // One change of state a render: not while the page itself moves on or its look moves.
  if (ended === undefined && peek !== undefined && peekAt === peek && !emptied && !passing && after !== undefined && !(after instanceof Error) && found !== foundBefore) setState({ ...current, found });
  const more = ended === undefined ? peek === undefined || after instanceof Error || (after === undefined ? (foundBefore ?? true) : found) : found;

  // A list not read (`"skip"`) lets go of the rows it showed: asked for again, it is another list's rows until it is read.
  if (args === "skip" && shown !== undefined) setShown(undefined);
  const visible = args === "skip" ? undefined : emptied ? shown : (data ?? shown);
  // The list whose rows are up, or were last: another list asked for before the first rows arrive, or after a list
  // not read (which counts as shown), is another's until its own rows come.
  const [seen, setSeen] = useState(list);
  const showing = args === "skip" ? list : (visible?.list ?? seen);
  if (showing !== seen) setSeen(showing);
  const page = visible?.number ?? want + 1;
  // The same array until the page shown changes, so what's derived from it isn't rebuilt each render.
  const items = useMemo(() => (visible?.page ?? []).slice(0, pageSize), [visible, pageSize]);
  return {
    items,
    /** Nothing has loaded yet, or a first full page still waits, the first time only, to know whether a page comes after it: the pager comes with the rows, never after them. */
    isLoading: visible === undefined || (page === 1 && peek !== undefined && ended === undefined && after === undefined && foundBefore === undefined),
    /** What's shown is an earlier page or earlier arguments, still waiting for the new one. */
    isStale: visible !== undefined && visible !== data,
    /** What's up, or was last, is of another `list` than the one asked for, still waiting for it: its rows aren't this list's. */
    isOther: showing !== list,
    /** The number of the page shown, from 1; it moves when the page it steps to arrives. */
    page,
    /** How many rows the pages before the one shown held; short pages make it less than (page - 1) × size. */
    offset: visible?.offset ?? 0,
    /** Whether the list runs past one page, from the page shown, so a pager stays up while the next loads. */
    hasPages: page > 1 || (visible !== undefined && !visible.isDone && more),
    canPrevious: starts.length > 0,
    canNext: data !== undefined && !data.isDone && more,
    previous: () => step(starts.slice(0, -1)),
    next: () => {
      if (data && !data.isDone) step([...starts, { cursor: data.continueCursor, offset: data.offset + data.page.length }]);
    },
  };
}
