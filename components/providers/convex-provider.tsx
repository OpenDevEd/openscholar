"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import {
  AuthKitProvider,
  useAuth,
  useAccessToken,
} from "@workos-inc/authkit-nextjs/components";
import { ReactNode, useCallback, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * Custom hook to bridge WorkOS AuthKit with Convex authentication
 */
function useAuthFromAuthKit() {
  const { user, loading: isLoading } = useAuth();
  const {
    accessToken,
    loading: tokenLoading,
    error: tokenError,
  } = useAccessToken();

  const loading = (isLoading ?? false) || (tokenLoading ?? false);
  const authenticated = !!user && !!accessToken && !loading;

  // Stable ref prevents unnecessary re-renders and re-fetches
  const stableAccessToken = useRef<string | null>(null);
  if (accessToken && !tokenError) {
    stableAccessToken.current = accessToken;
  }

  const fetchAccessToken = useCallback(async () => {
    if (stableAccessToken.current && !tokenError) {
      return stableAccessToken.current;
    }
    return null;
  }, [tokenError]);

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
        <UserSync>{children}</UserSync>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

function UserSync({ children }: { children: ReactNode }) {
  // Sync user with Convex on load
  const { isAuthenticated } = useAuthFromAuthKit();
  const ensureUser = useMutation(api.users.mutations.ensureUser);
  const hasSynced = useRef(false);

  useEffect(() => {
    if (isAuthenticated && !hasSynced.current) {
      hasSynced.current = true;
      ensureUser({});
    }
    // Reset on logout
    if (!isAuthenticated) {
      hasSynced.current = false;
    }
  }, [isAuthenticated, ensureUser]);

  return <>{children}</>;
}
