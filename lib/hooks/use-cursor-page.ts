"use client";

import { useState } from "react";
import type { FunctionReference, PaginationResult, paginationOptsValidator } from "convex/server";
import type { Infer } from "convex/values";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

/** The page arguments a query declares with `paginationOptsValidator`, which carry an `id`. */
type PaginationOptions = Infer<typeof paginationOptsValidator>;
type PageQuery = FunctionReference<"query", "public", { paginationOpts: PaginationOptions }, PaginationResult<unknown>>;
type PageArgs<Query extends PageQuery> = Omit<Query["_args"], "paginationOpts">;
type PageItem<Query extends PageQuery> = Query["_returnType"]["page"][number];

/**
 * One page of a cursor-paged query, stepped with previous and next. It keeps the start
 * cursor of every page it passed, so it reads only the page shown, and starts over from
 * the first page when `args` change. The last page shown stays up until the next arrives.
 *
 * A live Convex page keeps the range it first read, so rows added inside it grow it past
 * `pageSize`; a grown page is read again from its start, under a new query id.
 */
export function useCursorPage<Query extends PageQuery>(query: Query, args: PageArgs<Query> | "skip", pageSize: number) {
  const key = JSON.stringify(args);
  const [state, setState] = useState<{ key: string; cursors: string[] }>({ key, cursors: [] });
  const cursors = state.key === key ? state.cursors : [];
  if (state.key !== key) setState({ key, cursors });
  const [reads, setReads] = useState(0);
  const paginationOpts: PaginationOptions = { cursor: cursors.at(-1) ?? null, numItems: pageSize, id: reads };
  const { data } = useProtectedQuery(query, args === "skip" ? "skip" : ({ ...args, paginationOpts } as Query["_args"]));
  if (data !== undefined && data.page.length > pageSize) setReads(reads + 1);
  const [shown, setShown] = useState<{ key: string; page: Query["_returnType"]; number: number } | undefined>(undefined);
  // A page emptied by deletions steps back to the one before it.
  const emptied = data !== undefined && data.page.length === 0 && cursors.length > 0;
  if (emptied) setState({ key, cursors: cursors.slice(0, -1) });
  else if (data !== undefined && (shown?.page !== data || shown.key !== key)) setShown({ key, page: data, number: cursors.length + 1 });

  const current = args === "skip" ? undefined : emptied ? shown?.page : (data ?? shown?.page);
  const page = current !== undefined && current !== data && shown ? shown.number : cursors.length + 1;
  return {
    items: (current?.page ?? []).slice(0, pageSize) as PageItem<Query>[],
    /** Nothing has loaded yet. */
    isLoading: current === undefined,
    /** What's shown is an earlier page or earlier arguments, still waiting for the new one. */
    isStale: current !== undefined && current !== data,
    /** The number of the page shown, from 1; it moves when the page it steps to arrives. */
    page,
    /** Whether the list runs past one page, from the page shown, so a pager stays up while the next loads. */
    hasPages: page > 1 || (current !== undefined && !current.isDone),
    canPrevious: cursors.length > 0,
    canNext: data !== undefined && !data.isDone,
    previous: () => setState({ key, cursors: cursors.slice(0, -1) }),
    next: () => {
      if (data && !data.isDone) setState({ key, cursors: [...cursors, data.continueCursor] });
    },
  };
}
