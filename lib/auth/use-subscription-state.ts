"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import { getPlanTier } from "@/convex/lib/constants";
import { api } from "@/convex/_generated/api";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import {
  isEntitledSubscription,
  resolveEffectivePlan,
  type SubscriptionPlan,
} from "@/lib/billing/entitlements";

type SubscriptionState = ReturnType<typeof useOwnedSubscriptionState>;

const SubscriptionStateContext = createContext<SubscriptionState | null>(null);

function useOwnedSubscriptionState(): {
  data: ReturnType<typeof useOptionalAuthQuery<typeof api.subscriptions.queries.getMy>>["data"];
  phase: ReturnType<typeof useOptionalAuthQuery<typeof api.subscriptions.queries.getMy>>["phase"];
  isDeferred: boolean;
  isReady: boolean;
  isAnonymous: boolean;
  settlement: ReturnType<typeof useOptionalAuthQuery<typeof api.subscriptions.queries.getMy>>["settlement"];
} & {
  subscription: ReturnType<typeof useOptionalAuthQuery<typeof api.subscriptions.queries.getMy>>["data"];
  isAuthLoading: boolean;
  isQueryLoading: boolean;
  isSettling: boolean;
  isEntitled: boolean;
  resolvedPlan: SubscriptionPlan | null;
  resolvedTier: number | null;
} {
  const query = useOptionalAuthQuery(api.subscriptions.queries.getMy, {});
  const subscription = query.data;

  const isAuthLoading = query.settlement === "auth_loading";
  const isQueryLoading = query.settlement === "query_loading";
  const isSettling = isAuthLoading || isQueryLoading;
  const isAnonymous = query.settlement === "anonymous";
  const isReady = query.settlement === "ready";
  const isEntitled = isReady ? isEntitledSubscription(subscription) : false;

  let resolvedPlan: SubscriptionPlan | null = null;
  if (isReady) {
    resolvedPlan = resolveEffectivePlan(subscription);
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
    isEntitled,
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
