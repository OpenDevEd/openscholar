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
import { FLAG_REGISTRY, type FlagName } from "./registry";

/**
 * Resolve a single feature flag for the current user.
 * DB rows are always available from the provider (preloaded server-side).
 * Flags that need a plan feature wait for the user's plan to load.
 */
export function useFeatureFlag(name: FlagName): boolean {
  const { planFeatures } = useSubscriptionState();
  return useFeatureFlagForPlan(name, planFeatures);
}

/** Like useFeatureFlag, for callers that already hold the subscription state. */
export function useFeatureFlagForPlan(
  name: FlagName,
  planFeatures: readonly string[] | null,
): boolean {
  const dbFlags = useDbFlags();
  if (!dbFlags) return resolveFlagDefault(name, planFeatures);
  const flag = dbFlags.find((f) => f.key === name);
  if (!flag) return false;
  return resolveFlag(flag.enabled, flag.planFeature, planFeatures);
}

/**
 * Resolve all feature flags at once for the current user.
 * Memoized — stable reference as long as dbFlags and plan features don't change.
 */
export function useFeatureFlags(): ResolvedFlags {
  const { planFeatures } = useSubscriptionState();
  const dbFlags = useDbFlags();
  return useMemo(() => resolveAllFlags(dbFlags, planFeatures), [dbFlags, planFeatures]);
}

/** The Autumn feature a flag requires of the user's plan, if any. */
export function useFlagPlanFeature(name: FlagName): string | undefined {
  const dbFlags = useDbFlags();
  const registered = FLAG_REGISTRY[name] as { planFeature?: string };
  const flag = dbFlags?.find((f) => f.key === name);
  return flag ? flag.planFeature : registered.planFeature;
}
