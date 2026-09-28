"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { PLAN_TIER, type PlanId } from "@/lib/billing/plans";

type SubscriptionState = ReturnType<typeof useOwnedSubscriptionState>;

const SubscriptionStateContext = createContext<SubscriptionState | null>(null);

/** The signed-in user's plan and credits, from the cached billing snapshot. */
function useOwnedSubscriptionState() {
  const query = useOptionalAuthQuery(api.billing.accounts.mine, {});
  const account = query.data ?? null;

  const isAuthLoading = query.settlement === "auth_loading";
  const isQueryLoading = query.settlement === "query_loading";
  const isSettling = isAuthLoading || isQueryLoading;
  const isAnonymous = query.settlement === "anonymous";
  const isReady = query.settlement === "ready";

  const resolvedPlan: PlanId | null = isReady ? (account?.plan ?? "free") : null;
  const resolvedTier = resolvedPlan ? PLAN_TIER[resolvedPlan] : null;

  return {
    account,
    isAuthLoading,
    isQueryLoading,
    isSettling,
    isAnonymous,
    isReady,
    resolvedPlan,
    resolvedTier,
  };
}

export function SubscriptionStateProvider({
  children,
}: {
  children: ReactNode;
}) {
  const state = useOwnedSubscriptionState();
  return createElement(SubscriptionStateContext.Provider, { value: state }, children);
}

export function useSubscriptionState() {
  return useOwnedSubscriptionState();
}

export function useSharedSubscriptionState() {
  const state = useContext(SubscriptionStateContext);
  if (state === null) {
    throw new Error("useSharedSubscriptionState must be used within SubscriptionStateProvider");
  }
  return state;
}

export function useSubscriptionStateSelector<T>(
  selector: (state: SubscriptionState) => T,
) {
  return selector(useSharedSubscriptionState());
}
