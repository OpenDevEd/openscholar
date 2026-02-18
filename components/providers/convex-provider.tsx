"use client";

import { ConvexReactClient, ConvexProviderWithAuth, useConvexAuth, useMutation } from "convex/react";
import {
  AuthKitProvider,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/convex/_generated/api";
import { createConvexAuthTokenFetcher } from "@/lib/auth/convex-token-fetcher";
import { PostHogIdentify } from "@/components/posthog-identify";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const MAX_SYNC_RETRIES = 6;
const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

export type AuthReadinessPhase =
  | "initializing"
  | "authenticated"
  | "anonymous"
  | "sync_error";

type AuthReadinessContextValue = {
  phase: AuthReadinessPhase;
  isBootstrapping: boolean;
  canRunProtectedQueries: boolean;
  retryUserSync: () => void;
};

const AuthReadinessContext = createContext<AuthReadinessContextValue | undefined>(
  undefined,
);

/**
 * Custom hook to bridge WorkOS AuthKit with Convex authentication
 */
function useAuthFromAuthKit() {
  const { user, loading: authLoading } = useAuth();
  const fetchAccessTokenFromRoute = useCallback(async (): Promise<string | undefined> => {
    if (!user) return undefined;

    try {
      const response = await fetch("/auth/access-token", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Cache-Control": "no-store" },
      });

      if (!response.ok) {
        return undefined;
      }

      const payload = (await response.json()) as { accessToken?: string | null };
      return typeof payload.accessToken === "string" && payload.accessToken.length > 0
        ? payload.accessToken
        : undefined;
    } catch {
      return undefined;
    }
  }, [user?.id]);
  const getAccessToken = useCallback(() => fetchAccessTokenFromRoute(), [fetchAccessTokenFromRoute]);
  const refresh = useCallback(() => fetchAccessTokenFromRoute(), [fetchAccessTokenFromRoute]);
  const fetchAccessToken = useMemo(
    () => createConvexAuthTokenFetcher({ getAccessToken, refresh }),
    [getAccessToken, refresh],
  );

  return {
    isLoading: Boolean(authLoading),
    isAuthenticated: Boolean(user),
    fetchAccessToken,
  };
}

/**
 * Combined Convex + WorkOS AuthKit provider
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        <AuthReadinessProvider>{children}</AuthReadinessProvider>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

export function useAuthReadiness() {
  const context = useContext(AuthReadinessContext);
  if (!context) {
    throw new Error("useAuthReadiness must be used within ConvexClientProvider");
  }
  return context;
}

function AuthReadinessProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.mutations.ensureUser);
  const hasSynced = useRef(false);
  const syncInFlight = useRef(false);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "synced" | "error">(
    "idle",
  );

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return clearRetryTimer;
  }, [clearRetryTimer]);

  useEffect(() => {
    const hasAuthSession = Boolean(user) || authLoading;

    if (!isAuthenticated) {
      // During token refresh / websocket re-auth, Convex can be temporarily
      // unauthenticated while AuthKit still has an active session.
      if (hasAuthSession) {
        return;
      }

      hasSynced.current = false;
      syncInFlight.current = false;
      retryAttemptRef.current = 0;
      setSyncAttempt(0);
      setSyncState("idle");
      clearRetryTimer();
      return;
    }

    if (hasSynced.current) {
      if (syncState !== "synced") {
        setSyncState("synced");
      }
      return;
    }

    if (syncState === "error") {
      return;
    }

    if (isLoading || syncInFlight.current) {
      if (syncState === "idle") {
        setSyncState("syncing");
      }
      return;
    }

    syncInFlight.current = true;
    setSyncState("syncing");
    void ensureUser({})
      .then(() => {
        hasSynced.current = true;
        retryAttemptRef.current = 0;
        setSyncAttempt(0);
        setSyncState("synced");
        clearRetryTimer();
      })
      .catch((error) => {
        hasSynced.current = false;
        retryAttemptRef.current += 1;
        const retryAttempt = retryAttemptRef.current;
        if (retryAttempt > MAX_SYNC_RETRIES) {
          console.error("[Auth] ensureUser sync failed; retry budget exhausted", error);
          setSyncState("error");
          clearRetryTimer();
          return;
        }
        const delayMs = Math.min(
          BASE_RETRY_MS * (2 ** (retryAttempt - 1)),
          MAX_RETRY_MS,
        );
        console.error(`[Auth] ensureUser sync failed; retrying in ${delayMs}ms`, error);
        clearRetryTimer();
        retryTimerRef.current = setTimeout(() => {
          setSyncAttempt((attempt) => attempt + 1);
        }, delayMs);
      })
      .finally(() => {
        syncInFlight.current = false;
      });
  }, [
    authLoading,
    clearRetryTimer,
    ensureUser,
    isAuthenticated,
    isLoading,
    syncAttempt,
    syncState,
    user,
  ]);

  const phase: AuthReadinessPhase = useMemo(() => {
    if (isAuthenticated && hasSynced.current) {
      return "authenticated";
    }
    if (isAuthenticated && syncState === "error") {
      return "sync_error";
    }
    if (!user && !authLoading && !isLoading) {
      return "anonymous";
    }
    if (authLoading || isLoading || Boolean(user) || isAuthenticated) {
      return "initializing";
    }
    return "anonymous";
  }, [authLoading, isAuthenticated, isLoading, syncState, user]);

  const retryUserSync = useCallback(() => {
    if (!isAuthenticated) return;
    hasSynced.current = false;
    syncInFlight.current = false;
    retryAttemptRef.current = 0;
    setSyncState("idle");
    clearRetryTimer();
    setSyncAttempt((attempt) => attempt + 1);
  }, [clearRetryTimer, isAuthenticated]);

  const contextValue = useMemo<AuthReadinessContextValue>(
    () => ({
      phase,
      isBootstrapping: phase === "initializing",
      canRunProtectedQueries: phase === "authenticated",
      retryUserSync,
    }),
    [phase, retryUserSync],
  );

  return (
    <AuthReadinessContext.Provider value={contextValue}>
      <PostHogIdentify />
      {children}
    </AuthReadinessContext.Provider>
  );
}
