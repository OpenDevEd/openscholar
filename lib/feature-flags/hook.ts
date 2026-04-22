/**
 * React Hooks for Feature Flags
 * ==============================
 * Reads pre-loaded flag rows from FeatureFlagProvider context.
 * Flags are available on first render (no loading flash) because the
 * root layout preloads them server-side via `preloadQuery`.
 */

"use client";

import { useMemo } from "react";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { resolveFlag, resolveFlagDefault, resolveAllFlags, type ResolvedFlags } from "./resolve";
import { useDbFlags } from "./provider";
import type { FlagName } from "./registry";

function resolveFeatureFlagForTier(
  name: FlagName,
  resolvedTier: number | null,
  dbFlags: ReturnType<typeof useDbFlags>,
): boolean {
  if (!dbFlags) {
    return resolveFlagDefault(name, resolvedTier);
  }

  const flag = dbFlags.find((f) => f.key === name);
  if (!flag) return false;
  return resolveFlag(flag.enabled, flag.minimumTier, resolvedTier);
}

/**
 * Resolve a single feature flag for the current user.
 * DB rows are always available from the provider (preloaded server-side).
 * Tier-gated flags still depend on the subscription loading client-side.
 */
export function useFeatureFlag(name: FlagName): boolean {
  const { resolvedTier } = useSubscriptionState();
  return useFeatureFlagForResolvedTier(name, resolvedTier);
}

export function useFeatureFlagForResolvedTier(
  name: FlagName,
  resolvedTier: number | null,
): boolean {
  const dbFlags = useDbFlags();
  return resolveFeatureFlagForTier(name, resolvedTier, dbFlags);
}

/**
 * Resolve all feature flags at once for the current user.
 * Memoized — stable reference as long as dbFlags and tier don't change.
 */
export function useFeatureFlags(): ResolvedFlags {
  const { resolvedTier } = useSubscriptionState();
  const dbFlags = useDbFlags();

  return useMemo(
    () => resolveAllFlags(dbFlags, resolvedTier),
    [dbFlags, resolvedTier],
  );
}
