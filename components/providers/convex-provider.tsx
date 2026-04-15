"use client";
"use no memo";

import { ConvexReactClient, useConvexAuth, useMutation, type Preloaded } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth, useUser } from "@clerk/nextjs";
import { useLocale } from "next-intl";
import { useTheme } from "next-themes";
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
import { PostHogIdentify } from "@/components/posthog-identify";
import {
  resolveClerkAppearance,
  resolveClerkLocalization,
} from "@/lib/auth/clerk-ui-config";
import { FeatureFlagProvider } from "@/lib/feature-flags/provider";

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

export function ConvexClientProvider({
  children,
  preloadedFlags,
}: {
  children: ReactNode;
  preloadedFlags: Preloaded<typeof api.featureFlags.queries.getAll>;
}) {
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const clerkLocalization = useMemo(
    () => resolveClerkLocalization(locale),
    [locale],
  );
  const clerkAppearance = useMemo(
    () => resolveClerkAppearance(resolvedTheme),
    [resolvedTheme],
  );

  return (
    <ClerkProvider localization={clerkLocalization} appearance={clerkAppearance}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AuthReadinessProvider>
          <FeatureFlagProvider preloadedFlags={preloadedFlags}>
            {children}
          </FeatureFlagProvider>
        </AuthReadinessProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
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
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
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
    const hasAuthSession = !isLoaded || Boolean(user) || Boolean(isSignedIn);

    if (!isAuthenticated) {
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
    clearRetryTimer,
    ensureUser,
    isAuthenticated,
    isLoaded,
    isLoading,
    isSignedIn,
    syncAttempt,
    syncState,
    user,
  ]);

  const phase: AuthReadinessPhase = useMemo(() => {
    if (isAuthenticated && syncState === "synced") {
      return "authenticated";
    }
    if (isAuthenticated && syncState === "error") {
      return "sync_error";
    }
    if (isLoaded && !isSignedIn && !isLoading) {
      return "anonymous";
    }
    if (!isLoaded || isLoading || Boolean(isSignedIn) || isAuthenticated) {
      return "initializing";
    }
    return "anonymous";
  }, [isAuthenticated, isLoaded, isLoading, isSignedIn, syncState]);

  const retryUserSync = useCallback(() => {
    if (!isAuthenticated) return;
    hasSynced.current = false;
    syncInFlight.current = false;
    retryAttemptRef.current = 0;
    setSyncState("idle");
    clearRetryTimer();
    setSyncAttempt((attempt) => attempt + 1);
  }, [clearRetryTimer, isAuthenticated]);

  // Retry auth sync when user returns to a stale tab (CRASH-03, per D-09)
  useEffect(() => {
    let lastRetryTimestamp = Date.now(); // Initialize to now to skip first fire (Pitfall 3)
    const COOLDOWN_MS = 5000; // 5-second cooldown per D-10

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRetryTimestamp < COOLDOWN_MS) return;
      lastRetryTimestamp = now;
      retryUserSync();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [retryUserSync]);

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
