"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { defaultPlanId } from "@/lib/billing/catalog";
import { useBillingCatalog } from "@/lib/billing/catalog-provider";

type SubscriptionState = ReturnType<typeof useOwnedSubscriptionState>;

const NO_FEATURES: readonly string[] = [];

const SubscriptionStateContext = createContext<SubscriptionState | null>(null);

/**
 * The signed-in user's plan, plan features and credits, from the cached
 * billing snapshot, and Autumn's catalog to describe them.
 */
function useOwnedSubscriptionState() {
  const query = useOptionalAuthQuery(api.billing.accounts.mine, {});
  const catalog = useBillingCatalog();
  const account = query.data ?? null;

  const isAuthLoading = query.settlement === "auth_loading";
  const isQueryLoading = query.settlement === "query_loading";
  const isSettling = isAuthLoading || isQueryLoading;
  const isAnonymous = query.settlement === "anonymous";
  const isReady = query.settlement === "ready";

  const resolvedPlan: string | null = isReady
    ? (account?.plan ?? (catalog ? defaultPlanId(catalog) : undefined) ?? null)
    : null;
  // On the plan every customer starts with (Free), rather than one they chose.
  const onDefaultPlan = resolvedPlan === null ? null : !catalog || resolvedPlan === defaultPlanId(catalog);
  // Autumn features the user's plans grant; null until known.
  const planFeatures: readonly string[] | null = isReady ? (account?.features ?? NO_FEATURES) : null;

  return {
    account,
    isAuthLoading,
    isQueryLoading,
    isSettling,
    isAnonymous,
    isReady,
    resolvedPlan,
    onDefaultPlan,
    planFeatures,
    catalog,
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
