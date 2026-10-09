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
import { useWorkspace } from "../workspaces/url";
import { useWorkspaceSlug } from "../workspaces/href";
import type { Id } from "@/convex/_generated/dataModel";

const localSnapshot = { ready: true, error: null, pending: 0 };
const localSubscribe = () => activateResearch(null);
const getLocalSnapshot = () => localSnapshot;
const StatusContext = createContext({ ...localSnapshot, error: null as Error | null, retry: () => {} });
const sessions = new WeakMap<ConvexReactClient, Map<string, ResearchSession>>();
/**
 * The account's records in the workspace an address names (#651): switching workspace reads
 * another's. Keyed by the address, so the session a page starts while its workspace loads is the
 * one that workspace's records are read and written through once it's known.
 */
function workspaceSession(client: ConvexReactClient, accountId: string, slug: string | undefined, workspaceId: Id<"workspaces"> | undefined) {
  let accounts = sessions.get(client);
  if (!accounts) { accounts = new Map(); sessions.set(client, accounts); }
  const key = `${accountId}:${slug ?? ""}`;
  let session = accounts.get(key);
  if (!session) { session = new ResearchSession(client, accountId); accounts.set(key, session); }
  if (workspaceId) session.bind({ workspaceId, own: slug === undefined });
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
  // The session reads the account's records in the page's workspace, from when it has loaded.
  const workspaceId = useWorkspace();
  const slug = useWorkspaceSlug();
  const session = userId ? workspaceSession(client, userId, slug, workspaceId) : null;
  const subscribe = useCallback((listener: () => void) => session ? session.subscribe(listener, phase === "authenticated", report) : localSubscribe(), [session, phase, report]);
  const status = useSyncExternalStore(subscribe, session?.getSnapshot ?? getLocalSnapshot, session?.getServerSnapshot ?? getLocalSnapshot);
  // The same account and workspace the session reads under, for hooks reading beside it.
  const scope = useMemo(() => (userId && workspaceId ? { accountId: userId, workspaceId } : undefined), [userId, workspaceId]);
  const reading = useMemo(() => ({ session, phase, scope }), [session, phase, scope]);
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
  return ready ? children : <div className="flex min-h-screen items-center justify-center" aria-busy="true"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-foreground" /></div>;
}
