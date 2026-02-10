"use client";

import { getPlanTier } from "@/convex/lib/constants";
import { api } from "@/convex/_generated/api";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";

type SubscriptionPlan = "free" | "go" | "pro" | "enterprise";

export function useSubscriptionState() {
  const query = useOptionalAuthQuery(api.subscriptions.queries.getMy, {});
  const subscription = query.data;

  const isAuthLoading = query.settlement === "auth_loading";
  const isQueryLoading = query.settlement === "query_loading";
  const isSettling = isAuthLoading || isQueryLoading;
  const isAnonymous = query.settlement === "anonymous";
  const isReady = query.settlement === "ready";

  let resolvedPlan: SubscriptionPlan | null = null;
  if (isReady) {
    resolvedPlan = subscription ? subscription.plan : "free";
  }
  const resolvedTier = resolvedPlan ? getPlanTier(resolvedPlan) : null;

  return {
    ...query,
    subscription,
    isAuthLoading,
    isQueryLoading,
    isSettling,
    isAnonymous,
    isReady,
    resolvedPlan,
    resolvedTier,
  };
}
