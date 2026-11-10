"use client";
"use no memo";

import { useConvexAuth, useMutation, type Preloaded } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { readConsent } from "@/lib/consent-cookie";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import type { LocalizationResource } from "@clerk/nextjs/types";
import { useTheme } from "next-themes";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { api } from "@/convex/_generated/api";
import {
  resolveClerkAppearance,
} from "@/lib/auth/clerk-ui-config";
import { FeatureFlagProvider } from "@/lib/feature-flags/provider";
import { BillingCatalogProvider } from "@/lib/billing/catalog-provider";
import { UserSync } from "@/lib/auth/user-sync";
import { RetryingConvexClient } from "@/lib/convex-client";

const convex = new RetryingConvexClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const noSubscription = () => () => {};

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
  preloadedCatalog,
  clerkLocalization,
}: {
  children: ReactNode;
  /** Clerk's screens in the page's language, read on the server. */
  clerkLocalization: LocalizationResource | undefined;
  preloadedFlags: Preloaded<typeof api.featureFlags.queries.list>;
  preloadedCatalog: Preloaded<typeof api.billing.catalog.get>;
}) {
  const { resolvedTheme } = useTheme();
  const clerkAppearance = useMemo(
    () => resolveClerkAppearance(resolvedTheme),
    [resolvedTheme],
  );

  return (
    <ClerkProvider localization={clerkLocalization} appearance={clerkAppearance}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AuthReadinessProvider>
          <FeatureFlagProvider preloadedFlags={preloadedFlags}>
            <BillingCatalogProvider preloadedCatalog={preloadedCatalog}>
              {children}
            </BillingCatalogProvider>
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
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.mutations.ensureUser);
  const sessionKey = `${userId ?? "anonymous"}:${sessionId ?? "initializing"}`;
  const sync = useMemo(
    () => new UserSync(sessionKey, () => ensureUser({ analyticsConsent: readConsent()?.choice })),
    [sessionKey, ensureUser],
  );
  const canSync = Boolean(isLoaded && isSignedIn && userId && isAuthenticated && !isLoading);
  const syncState = useSyncExternalStore(
    canSync ? sync.subscribe : noSubscription,
    sync.getSnapshot,
    sync.getServerSnapshot,
  );

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
    if (canSync) sync.retry();
  }, [canSync, sync]);

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
    <AuthReadinessContext.Provider value={contextValue}>{children}</AuthReadinessContext.Provider>
  );
}
