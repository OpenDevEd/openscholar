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
import { activateResearch, ResearchContext, SessionContext } from "./binding";
import { ResearchSession } from "./session";
import { ResearchImportError, localResearchBackup } from "./migrate";
import { downloadAsFile } from "../utils";

const localSnapshot = { ready: true, error: null, pending: 0 };
const localSubscribe = () => activateResearch(null);
const getLocalSnapshot = () => localSnapshot;
const StatusContext = createContext({ ...localSnapshot, error: null as Error | null, retry: () => {} });
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
  const reading = useMemo(() => ({ session, phase }), [session, phase]);
  const value = useMemo(() => ({ ...status, ready: status.ready && (phase === "anonymous" || phase === "authenticated"), error: phase === "sync_error" ? new Error("Your account could not finish loading.") : status.error, retry: phase === "sync_error" ? retryUserSync : session?.retry ?? (() => {}) }), [status, session, phase, retryUserSync]);
  return <ResearchContext.Provider value={session?.stores ?? null}><SessionContext.Provider value={reading}><StatusContext.Provider value={value}>{children}</StatusContext.Provider></SessionContext.Provider></ResearchContext.Provider>;
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
