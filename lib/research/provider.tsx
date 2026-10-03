"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useConvex, type ConvexReactClient } from "convex/react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { showStyledToast } from "@/components/ui/sonner";
import { usePersistedStoreReady } from "../use-persisted-store-ready";
import { localKeywordExpansionStore, localRatingsStore, localSearchHistoryStore } from "../store";
import { activateResearch, ResearchContext } from "./binding";
import { ResearchSession, type WatchedStatus } from "./session";
import { serializeSearch } from "./records";
import type { SearchResult } from "../types";
import { ResearchImportError, localResearchBackup } from "./migrate";
import { downloadAsFile } from "../utils";

const localSnapshot = { ready: true, error: null, pending: 0 };
const localSubscribe = () => activateResearch(null);
const getLocalSnapshot = () => localSnapshot;
const StatusContext = createContext({ ...localSnapshot, error: null as Error | null, retry: () => {} });
/** The signed-in account's session, which reads searches by ID; null signed out. */
const SessionContext = createContext<ResearchSession | null>(null);
const sessions = new WeakMap<ConvexReactClient, Map<string, ResearchSession>>();
function accountSession(client: ConvexReactClient, accountId: string) {
  let accounts = sessions.get(client);
  if (!accounts) { accounts = new Map(); sessions.set(client, accounts); }
  let session = accounts.get(accountId);
  if (!session) { session = new ResearchSession(client, accountId); accounts.set(accountId, session); }
  return session;
}

/** Subscribes to the Convex client; no application state is copied through an effect. */
export function ResearchStateProvider({ children }: { children: ReactNode }) {
  const client = useConvex();
  const { userId } = useAuth();
  const { phase, retryUserSync } = useAuthReadiness();
  const t = useTranslations("common");
  const retryLabel = t("retry");
  const report = useCallback((error: Error, retry: () => void) => {
    showStyledToast("error", error.message, { duration: Infinity, action: { label: retryLabel, onClick: retry, ...(error instanceof ResearchImportError ? { secondaryAction: { label: "Download backup", onClick: () => downloadAsFile(localResearchBackup(), "local-research-backup.json", "json") } } : {}) } });
  }, [retryLabel]);
  const session = userId ? accountSession(client, userId) : null;
  const subscribe = useCallback((listener: () => void) => session ? session.subscribe(listener, phase === "authenticated", report) : localSubscribe(), [session, phase, report]);
  const status = useSyncExternalStore(subscribe, session?.getSnapshot ?? getLocalSnapshot, session?.getServerSnapshot ?? getLocalSnapshot);
  const value = useMemo(() => ({ ...status, ready: status.ready && (phase === "anonymous" || phase === "authenticated"), error: phase === "sync_error" ? new Error("Your account could not finish loading.") : status.error, retry: phase === "sync_error" ? retryUserSync : session?.retry ?? (() => {}) }), [status, session, phase, retryUserSync]);
  return <ResearchContext.Provider value={session?.stores ?? null}><SessionContext.Provider value={session}><StatusContext.Provider value={value}>{children}</StatusContext.Provider></SessionContext.Provider></ResearchContext.Provider>;
}

/** The signed-in account's research session, or null signed out. */
export function useResearchSession() {
  return useContext(SessionContext);
}

const found = (): WatchedStatus => "found";

/** Says whether search `id` is saved: in this browser signed out, in the account signed in. */
export function useHasSearch() {
  const session = useContext(SessionContext);
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
  const session = useContext(SessionContext);
  return useCallback((search: SearchResult) => {
    if (session) setTimeout(session.watchSearch(search.id, () => {}, serializeSearch(search)), PRELOAD_MS);
  }, [session]);
}
const noReaders = () => () => {};

/**
 * Has the signed-in session read search `id` while this component shows, so the search
 * stores' `getSearchResult(id)` has it. Says whether it's still loading, there, or not
 * saved. Signed out, every search is in this browser's store already.
 */
export function useWatchedSearch(id: string | undefined): WatchedStatus {
  const session = useContext(SessionContext);
  const subscribe = useCallback((listener: () => void) => (session && id ? session.watchSearch(id, listener) : noReaders()), [session, id]);
  const status = useCallback(() => (session && id ? session.watchedStatus(id) : found()), [session, id]);
  return useSyncExternalStore(subscribe, status, status);
}

export function useResearchStatus() {
  const status = useContext(StatusContext);
  const historyReady = usePersistedStoreReady(localSearchHistoryStore);
  const shortcutsReady = usePersistedStoreReady(localKeywordExpansionStore);
  const ratingsReady = usePersistedStoreReady(localRatingsStore);
  return { ...status, ready: status.ready && historyReady && shortcutsReady && ratingsReady };
}

export function ResearchLoading({ children }: { children: ReactNode }) {
  const { ready, error, retry } = useResearchStatus();
  if (error && !ready) return <AuthStatePanel variant="sync_error_retry" onRetry={retry} />;
  return ready ? children : <div className="flex min-h-screen items-center justify-center" aria-busy="true"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" /></div>;
}
