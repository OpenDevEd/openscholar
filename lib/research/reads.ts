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
import type { ResearchSession, WatchedStatus } from "./session";

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
 * Holds a read of something about these papers, by paper ID, while this component shows.
 * Returns the papers it's read for, from the first, whether more are on their way, and
 * whether a read failed. `watch`, `read` and `failed` are the session's for that read;
 * `watch` is null when nothing is to be read.
 */
function useReadPapers<Paper extends { id: string }>(
  papers: Paper[],
  watch: ((session: ResearchSession, paperIds: string[], listener: () => void) => () => void) | null,
  read: (session: ResearchSession, paperIds: string[]) => number,
  failed: (session: ResearchSession, paperIds: string[]) => boolean = () => false,
  scope = "",
): { papers: Paper[]; loading: boolean; failed: boolean } {
  const { session, phase } = useContext(SessionContext);
  // The account reads once it's ready; until then its papers wait, and if it can't load they show as they are.
  const reads = session !== null && watch !== null && phase === "authenticated";
  const waits = session !== null && watch !== null && phase === "initializing";
  const key = papers.map((paper) => paper.id).join("\n");
  // `scope` stands for what `watch`, `read` and `failed` close over: they're new functions on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subscribe = useCallback((listener: () => void) => (session && reads && key ? watch!(session, key.split("\n"), listener) : noReaders()), [session, reads, key, scope]);
  // One number says both: how many papers are read, and half more when a read failed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state = useCallback(() => (session && reads && key ? read(session, key.split("\n")) + (failed(session, key.split("\n")) ? 0.5 : 0) : waits ? 0 : papers.length), [session, reads, waits, key, papers.length, scope]);
  const known = useSyncExternalStore(subscribe, state, state);
  const count = Math.floor(known);
  return { ...(count >= papers.length ? { papers, loading: false } : { papers: papers.slice(0, count), loading: true }), failed: known !== count };
}

/**
 * Has the signed-in session read the person's ratings of these papers while this component
 * shows, so the ratings store has them. Returns the papers whose ratings are read, from the
 * first, and whether more are on their way: a page shows a paper once its rating is known,
 * so its rating control never changes size after it appears. Signed out, every rating is in
 * this browser's store.
 */
export function useRatedPapers<Paper extends { id: string }>(papers: Paper[]): { papers: Paper[]; loading: boolean } {
  return useReadPapers(papers, (session, paperIds, listener) => session.watchRatings(paperIds, listener), (session, paperIds) => session.ratingsRead(paperIds));
}

/**
 * Has the signed-in session read search `searchId`'s screening answers for these papers while
 * this component shows, so the search in the store has them. Returns the papers whose answers
 * are read, from the first, and whether more are on their way: a page screens a paper only
 * once it knows what's already answered. `failed` says a read failed: the papers show, but
 * what they're answered isn't known, so nothing should screen them. Signed out, or with no
 * saved search, nothing is read.
 */
export function useAnsweredPapers<Paper extends { id: string }>(searchId: string | undefined, papers: Paper[]): { papers: Paper[]; loading: boolean; failed: boolean } {
  return useReadPapers(
    papers,
    searchId ? (session, paperIds, listener) => session.watchAnswers(searchId, paperIds, listener) : null,
    (session, paperIds) => (searchId ? session.answersRead(searchId, paperIds) : paperIds.length),
    (session, paperIds) => searchId !== undefined && session.answersFailed(searchId, paperIds),
    searchId,
  );
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
