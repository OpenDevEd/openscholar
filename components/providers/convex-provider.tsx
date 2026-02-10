"use client";

import { ConvexReactClient, ConvexProviderWithAuth, useConvexAuth, useMutation } from "convex/react";
import {
  AuthKitProvider,
  useAuth,
  useAccessToken,
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
  const { user, loading: isLoading } = useAuth();
  const {
    accessToken,
    loading: tokenLoading,
    error: tokenError,
    getAccessToken,
  } = useAccessToken();
  const stableTokenRef = useRef<string | null>(null);
  const [initialTokenProbeInFlight, setInitialTokenProbeInFlight] = useState(false);
  const [resolvedAuthEpoch, setResolvedAuthEpoch] = useState<string | null>(null);
  const authEpoch = user?.id ? `user:${user.id}` : "anonymous";

  useEffect(() => {
    if (accessToken) {
      stableTokenRef.current = accessToken;
    }
  }, [accessToken]);

  useEffect(() => {
    if (tokenError) {
      stableTokenRef.current = null;
    }
  }, [tokenError]);

  useEffect(() => {
    if ((isLoading ?? false) || (tokenLoading ?? false)) {
      return;
    }

    if (resolvedAuthEpoch === authEpoch) {
      return;
    }

    if (accessToken || stableTokenRef.current) {
      setResolvedAuthEpoch(authEpoch);
      return;
    }

    if (initialTokenProbeInFlight) {
      return;
    }

    setInitialTokenProbeInFlight(true);
    void getAccessToken()
      .then((token) => {
        stableTokenRef.current = token ?? null;
      })
      .catch(() => {
        stableTokenRef.current = null;
      })
      .finally(() => {
        setResolvedAuthEpoch(authEpoch);
        setInitialTokenProbeInFlight(false);
      });
  }, [
    accessToken,
    authEpoch,
    getAccessToken,
    initialTokenProbeInFlight,
    isLoading,
    resolvedAuthEpoch,
    tokenLoading,
  ]);

  useEffect(() => {
    if (
      (isLoading ?? false) ||
      (tokenLoading ?? false) ||
      initialTokenProbeInFlight
    ) {
      return;
    }

    if (resolvedAuthEpoch !== authEpoch) {
      return;
    }

    if (!accessToken && !user) {
      stableTokenRef.current = null;
    }
  }, [
    accessToken,
    authEpoch,
    initialTokenProbeInFlight,
    isLoading,
    resolvedAuthEpoch,
    tokenLoading,
    user,
  ]);

  const initialTokenResolved = resolvedAuthEpoch === authEpoch;
  const loading =
    (isLoading ?? false) ||
    (tokenLoading ?? false) ||
    initialTokenProbeInFlight ||
    !initialTokenResolved;
  const stableAccessToken = accessToken ?? stableTokenRef.current;
  const authenticated = !!stableAccessToken && !loading && !tokenError;

  const fetchAccessToken = useCallback(async () => {
    if (stableTokenRef.current) return stableTokenRef.current;
    if (tokenError) return null;
    try {
      const token = await getAccessToken();
      stableTokenRef.current = token ?? null;
      return token ?? null;
    } catch {
      return null;
    }
  }, [getAccessToken, tokenError]);

  return {
    isLoading: loading,
    isAuthenticated: authenticated,
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
    if (!isAuthenticated) {
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
  }, [clearRetryTimer, ensureUser, isAuthenticated, isLoading, syncAttempt, syncState]);

  const phase: AuthReadinessPhase = useMemo(() => {
    if (isAuthenticated && hasSynced.current) {
      return "authenticated";
    }
    if (isAuthenticated && syncState === "error") {
      return "sync_error";
    }
    if (isLoading || isAuthenticated) {
      return "initializing";
    }
    return "anonymous";
  }, [isAuthenticated, isLoading, syncState]);

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
      {children}
    </AuthReadinessContext.Provider>
  );
}
