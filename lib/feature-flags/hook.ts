/**
 * React Hooks for Feature Flags
 * ==============================
 * Queries the featureFlags table via Convex reactive query.
 * During loading, falls back to static defaults from the registry.
 */

"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { resolveFlag, resolveFlagDefault, resolveAllFlags, type ResolvedFlags } from "./resolve";
import type { FlagName } from "./registry";

/**
 * Resolve a single feature flag for the current user.
 * During loading, boolean flags (minimumTier=0) use their default;
 * tier-gated flags conservatively return false.
 */
export function useFeatureFlag(name: FlagName): boolean {
  const { resolvedTier } = useSubscriptionState();
  const dbFlags = useQuery(api.featureFlags.queries.getAll);

  if (dbFlags === undefined) {
    return resolveFlagDefault(name, resolvedTier);
  }

  const flag = dbFlags.find((f) => f.key === name);
  if (!flag) return false;
  return resolveFlag(flag.enabled, flag.minimumTier, resolvedTier);
}

/**
 * Resolve all feature flags at once for the current user.
 * Memoized — stable reference as long as dbFlags and tier don't change.
 */
export function useFeatureFlags(): ResolvedFlags {
  const { resolvedTier } = useSubscriptionState();
  const dbFlags = useQuery(api.featureFlags.queries.getAll);

  return useMemo(
    () => resolveAllFlags(dbFlags, resolvedTier),
    [dbFlags, resolvedTier],
  );
}
