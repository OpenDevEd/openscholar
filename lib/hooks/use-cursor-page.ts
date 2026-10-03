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
type Shown<Query extends PageQuery> = Result<Query> & { key: string; number: number; from: Result<Query>[] };

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
 * the first page when `args` change. The last page shown stays up until the next arrives.
 *
 * A live Convex page keeps the range it first read, so rows added inside it grow it past
 * what was asked; a grown page is read again from its start, under a new query id.
 */
export function useCursorPage<Query extends PageQuery>(query: Query, args: PageArgs<Query> | "skip", pageSize: number) {
  const { canRunProtectedQueries } = useAuthReadiness();
  const key = JSON.stringify(args);
  // `starts` holds the start cursor of every page after the first; `reads`, the current page's reads.
  const fresh = { key, starts: [] as string[], reads: [{ cursor: null, numItems: pageSize }] as Read[], id: 0 };
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
    if (from.some((result, i) => result.page.length > reads[i].numItems)) {
      setState({ ...current, id: id + 1 });
    } else if (count < pageSize && !last.isDone && reads.length < MAX_READS_PER_PAGE) {
      setState({ ...current, reads: [...reads, { cursor: last.continueCursor, numItems: pageSize - count }] });
    } else if (shown?.key === key && shown.number === starts.length + 1 && shown.from.length === from.length && shown.from.every((result, i) => result === from[i])) {
      data = shown;
    } else {
      data = { key, number: starts.length + 1, from, page: from.flatMap((result) => result.page), isDone: last.isDone, continueCursor: last.continueCursor };
    }
  }

  const step = (nextStarts: string[]) => setState({ ...current, starts: nextStarts, reads: [{ cursor: nextStarts.at(-1) ?? null, numItems: pageSize }] });
  // A page emptied by deletions steps back to the one before it.
  const emptied = data !== undefined && data.page.length === 0 && data.isDone && starts.length > 0;
  if (emptied) step(starts.slice(0, -1));
  else if (data !== undefined && data !== shown) setShown(data);

  const visible = args === "skip" ? undefined : emptied ? shown : (data ?? shown);
  const page = visible?.number ?? starts.length + 1;
  return {
    items: (visible?.page ?? []).slice(0, pageSize),
    /** Nothing has loaded yet. */
    isLoading: visible === undefined,
    /** What's shown is an earlier page or earlier arguments, still waiting for the new one. */
    isStale: visible !== undefined && visible !== data,
    /** The number of the page shown, from 1; it moves when the page it steps to arrives. */
    page,
    /** Whether the list runs past one page, from the page shown, so a pager stays up while the next loads. */
    hasPages: page > 1 || (visible !== undefined && !visible.isDone),
    canPrevious: starts.length > 0,
    canNext: data !== undefined && !data.isDone,
    previous: () => step(starts.slice(0, -1)),
    next: () => {
      if (data && !data.isDone) step([...starts, data.continueCursor]);
    },
  };
}
