/**
 * React Hooks for Feature Flags
 * ==============================
 * Reads pre-loaded flag rows from FeatureFlagProvider context.
 * Flags are available on first render (no loading flash) because the
 * root layout preloads them server-side via `preloadQuery`.
 */

"use client";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { resolveFlag, resolveFlagDefault } from "./resolve";
import { useDbFlags } from "./provider";
import { type FlagName } from "./registry";

/**
 * Resolve a single feature flag for the current user.
 * DB rows are always available from the provider (preloaded server-side).
 * Flags that need a plan feature wait for the user's plan to load.
 */
export function useFeatureFlag(name: FlagName): boolean {
  const { planFeatures } = useSubscriptionState();
  return useFeatureFlagForPlan(name, planFeatures);
}

/** Whether the Team plan and its seats are on sale. */
export const useSeatBilling = () => useFeatureFlagForPlan("subscriptions.team", null);

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
