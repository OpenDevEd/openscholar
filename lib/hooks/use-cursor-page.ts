"use client";

import { useMemo, useState } from "react";
import { useQueries } from "convex/react";
import { getFunctionName, type FunctionReference, type PaginationResult, type paginationOptsValidator } from "convex/server";
import type { Infer } from "convex/values";
import { useAuthReadiness } from "@/components/providers/convex-provider";

/** The page arguments a query declares with `paginationOptsValidator`, which carry an `id`. */
type PaginationOptions = Infer<typeof paginationOptsValidator>;
type PageQuery = FunctionReference<"query", "public", { paginationOpts: PaginationOptions }, PaginationResult<unknown>>;
type PageArgs<Query extends PageQuery> = Omit<Query["_args"], "paginationOpts">;
type PageItem<Query extends PageQuery> = Query["_returnType"]["page"][number];
type Read = { cursor: string | null; numItems: number };
type Result<Query extends PageQuery> = { page: PageItem<Query>[]; isDone: boolean; continueCursor: string };
type Shown<Query extends PageQuery> = Result<Query> & { key: string; number: number; offset: number; from: Result<Query>[] };
/** Where a page after the first starts, and how many rows the pages before it held. */
type Start = { cursor: string; offset: number };

/**
 * Reads one page may take to fill. A filtered query stops after a set number of rows, so
 * a sparse filter returns a short page that isn't the end, and the page reads on from
 * where it stopped. ponytail: past this many reads it shows what it found, and next
 * carries on from there; a server index per filter would fill a page in one read.
 */
const MAX_READS_PER_PAGE = 5;

/**
 * One page of a cursor-paged query, stepped with previous and next. It keeps the start
 * cursor of every page it passed, so it reads only the page shown, and starts over from
 * the first page when `args` or the page size change. The last page shown stays up until the next arrives.
 *
 * A live Convex page keeps the range it first read, so rows added inside it grow it past
 * what was asked; a grown page is read again from its start, under a new query id. A page
 * can come back empty yet not be the end, when its reads found nothing; `canNext` says so.
 * A list that ends exactly on a full page finds that out from the empty page after it, and
 * stops offering next there.
 */
export function useCursorPage<Query extends PageQuery>(query: Query, args: PageArgs<Query> | "skip", pageSize: number) {
  const { canRunProtectedQueries } = useAuthReadiness();
  // A page of another size starts somewhere else, so the size is part of what the pages are of.
  const key = JSON.stringify([args, pageSize]);
  // `starts` holds where every page after the first starts; `reads`, the current page's reads.
  // `end` is the page the list was found to end on, by stepping to an empty page after it.
  const fresh = { key, starts: [] as Start[], reads: [{ cursor: null, numItems: pageSize }] as Read[], id: 0, end: undefined as number | undefined };
  const [state, setState] = useState(fresh);
  const current = state.key === key ? state : fresh;
  if (state.key !== key) setState(fresh);
  const { starts, reads, id } = current;

  const run = args !== "skip" && canRunProtectedQueries;
  // useQueries subscribes again whenever its request object changes, so it changes only with the reads.
  const requests = useMemo(
    () => (run ? Object.fromEntries(reads.map((read, i) => [String(i), { query, args: { ...args, paginationOpts: { ...read, id } } }])) : {}),
    // `key` stands for `args`, and the name for `query`, whose `api.*` reference is a new object on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, getFunctionName(query), key, reads, id],
  );
  const results = useQueries(requests) as Record<string, Result<Query> | Error | undefined>;
  const read = reads.map((_, i) => results[String(i)]);
  const error = read.find((result) => result instanceof Error);
  if (error) throw error;

  const [shown, setShown] = useState<Shown<Query> | undefined>(undefined);
  let data: Shown<Query> | undefined;
  if (args !== "skip" && read.every((result) => result !== undefined)) {
    const from = read as Result<Query>[];
    const last = from[from.length - 1];
    const count = from.reduce((sum, result) => sum + result.page.length, 0);
    if (count > pageSize || from.some((result, i) => result.page.length > reads[i].numItems || (i + 1 < from.length && result.continueCursor !== reads[i + 1].cursor))) {
      // Live rows grew a read, rows added to an earlier read pushed the page past its size, or a
      // read now stops somewhere else than where the next one starts: read the page again from
      // its start, so no row falls between two reads or shows in both.
      setState({ ...current, reads: [{ cursor: starts.at(-1)?.cursor ?? null, numItems: pageSize }], id: id + 1 });
    } else if (count < pageSize && !last.isDone && reads.length < MAX_READS_PER_PAGE) {
      setState({ ...current, reads: [...reads, { cursor: last.continueCursor, numItems: pageSize - count }] });
    } else if (shown?.key === key && shown.number === starts.length + 1 && shown.from.length === from.length && shown.from.every((result, i) => result === from[i])) {
      data = shown;
    } else {
      const offset = starts.at(-1)?.offset ?? 0;
      data = { key, number: starts.length + 1, offset, from, page: from.flatMap((result) => result.page), isDone: last.isDone, continueCursor: last.continueCursor };
    }
  }

  const step = (nextStarts: Start[], end?: number) => setState({ ...current, starts: nextStarts, reads: [{ cursor: nextStarts.at(-1)?.cursor ?? null, numItems: pageSize }], end });
  // An empty last page, after a list that ended on a full page or one emptied by deletions, steps
  // back to the page before it, the list's end. ponytail: that page offers next again only once
  // it's stepped away from, though rows may be added after it meanwhile.
  const emptied = data !== undefined && data.page.length === 0 && data.isDone && starts.length > 0;
  if (emptied) step(starts.slice(0, -1), starts.length - 1);
  else if (data !== undefined && data !== shown) setShown(data);

  const visible = args === "skip" ? undefined : emptied ? shown : (data ?? shown);
  const page = visible?.number ?? starts.length + 1;
  // The same array until the page shown changes, so what's derived from it isn't rebuilt each render.
  const items = useMemo(() => (visible?.page ?? []).slice(0, pageSize), [visible, pageSize]);
  return {
    items,
    /** Nothing has loaded yet. */
    isLoading: visible === undefined,
    /** What's shown is an earlier page or earlier arguments, still waiting for the new one. */
    isStale: visible !== undefined && visible !== data,
    /** The number of the page shown, from 1; it moves when the page it steps to arrives. */
    page,
    /** How many rows the pages before the one shown held; short pages make it less than (page - 1) × size. */
    offset: visible?.offset ?? 0,
    /** Whether the list runs past one page, from the page shown, so a pager stays up while the next loads. */
    hasPages: page > 1 || (visible !== undefined && !visible.isDone),
    canPrevious: starts.length > 0,
    canNext: data !== undefined && !data.isDone && current.end !== starts.length,
    previous: () => step(starts.slice(0, -1)),
    next: () => {
      if (data && !data.isDone) step([...starts, { cursor: data.continueCursor, offset: data.offset + data.page.length }]);
    },
  };
}
