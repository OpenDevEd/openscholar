"use client";

/**
 * The hooks pages use to read an account's research records by ID: a search, the ratings
 * of the papers on screen, the shortcuts a query names. Signed out, the records are in this
 * browser's stores and nothing is read. Kept apart from ./provider.tsx, which builds the
 * session, so the many components that read don't load it.
 */
import { useCallback, useContext, useSyncExternalStore } from "react";
import { localSearchHistoryStore } from "../store";
import { shortcutNames } from "../query-shortcuts";
import type { SearchResult } from "../types";
import { SessionContext } from "./binding";
import { serializeSearch } from "./records";
import type { WatchedStatus } from "./session";

/** The signed-in account's research session, or null signed out. */
export function useResearchSession() {
  return useContext(SessionContext).session;
}

const found = (): WatchedStatus => "found";
const noReaders = () => () => {};

/** Says whether search `id` is saved: in this browser signed out, in the account signed in. */
export function useHasSearch() {
  const { session } = useContext(SessionContext);
  return useCallback(
    async (id: string) => (session ? await session.hasSearch(id) : localSearchHistoryStore.getState().getSearchResult(id) !== undefined),
    [session],
  );
}

/** How long a search read ahead of its page is held, for that page to take the read over. */
const PRELOAD_MS = 10_000;

/**
 * Hands the account's session a search a list shows, as its link is followed, and starts
 * reading it, so its page opens at once; its screening answers follow with the read.
 */
export function usePreloadSearch() {
  const { session } = useContext(SessionContext);
  return useCallback((search: SearchResult) => {
    if (session) setTimeout(session.watchSearch(search.id, () => {}, serializeSearch(search)), PRELOAD_MS);
  }, [session]);
}

/**
 * Has the signed-in session read search `id` while this component shows, so the search
 * stores' `getSearchResult(id)` has it. Says whether it's still loading, there, or not
 * saved. Signed out, every search is in this browser's store already.
 */
export function useWatchedSearch(id: string | undefined): WatchedStatus {
  const { session } = useContext(SessionContext);
  const subscribe = useCallback((listener: () => void) => (session && id ? session.watchSearch(id, listener) : noReaders()), [session, id]);
  const status = useCallback(() => (session && id ? session.watchedStatus(id) : found()), [session, id]);
  return useSyncExternalStore(subscribe, status, status);
}

/**
 * Has the signed-in session read the person's ratings of these papers while this component
 * shows, so the ratings store has them. Returns the papers whose ratings are read, from the
 * first, and whether more are on their way: a page shows a paper once its rating is known,
 * so its rating control never changes size after it appears. Signed out, every rating is in
 * this browser's store.
 */
export function useRatedPapers<Paper extends { id: string }>(papers: Paper[]): { papers: Paper[]; loading: boolean } {
  const { session, phase } = useContext(SessionContext);
  // The account reads once it's ready; until then its papers wait, and if it can't load they show unrated.
  const reads = session !== null && phase === "authenticated";
  const waits = session !== null && phase === "initializing";
  const key = papers.map((paper) => paper.id).join("\n");
  const subscribe = useCallback((listener: () => void) => (session && reads && key ? session.watchRatings(key.split("\n"), listener) : noReaders()), [session, reads, key]);
  const read = useCallback(() => (session && reads && key ? session.ratingsRead(key.split("\n")) : waits ? 0 : papers.length), [session, reads, waits, key, papers.length]);
  const known = useSyncExternalStore(subscribe, read, read);
  return known >= papers.length ? { papers, loading: false } : { papers: papers.slice(0, known), loading: true };
}

/**
 * Has the signed-in session read the shortcuts these queries name while this component
 * shows, so the shortcut store expands them. Says whether they're read; signed out, every
 * shortcut is in this browser's store.
 */
export function useQueryShortcuts(...queries: Array<string | null | undefined>): boolean {
  const { session, phase } = useContext(SessionContext);
  const reads = session !== null && phase === "authenticated";
  const key = [...new Set(queries.flatMap((query) => (query ? shortcutNames(query) : [])))].join("\n");
  const subscribe = useCallback((listener: () => void) => (session && reads && key ? session.watchShortcuts(key.split("\n"), listener) : noReaders()), [session, reads, key]);
  const read = useCallback(() => (!session || !key ? true : reads && session.shortcutsRead(key.split("\n"))), [session, reads, key]);
  return useSyncExternalStore(subscribe, read, read);
}
