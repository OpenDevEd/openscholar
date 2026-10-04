"use client";

import { useCallback } from "react";
import {
  usePaginatedQuery,
  useQuery,
  type PaginatedQueryArgs,
  type PaginatedQueryItem,
  type PaginatedQueryReference,
  type UsePaginatedQueryReturnType,
} from "convex/react";
import type { FunctionReference } from "convex/server";
import { usePaginatedQuery as useStreamPaginatedQuery } from "convex-helpers/react";
import {
  useAuthReadiness,
  type AuthReadinessPhase,
} from "@/components/providers/convex-provider";

export type AuthQuerySettlement = "auth_loading" | "anonymous" | "query_loading" | "ready";

type QueryHookMetadata = {
  phase: AuthReadinessPhase;
  isDeferred: boolean;
  isReady: boolean;
  isAnonymous: boolean;
  settlement: AuthQuerySettlement;
};

function getSettlementState({
  phase,
  queryEnabled,
  hasData,
}: {
  phase: AuthReadinessPhase;
  queryEnabled: boolean;
  hasData: boolean;
}): AuthQuerySettlement {
  if (phase === "initializing" || phase === "sync_error") {
    return "auth_loading";
  }
  if (phase === "anonymous") {
    return "anonymous";
  }
  if (queryEnabled && !hasData) {
    return "query_loading";
  }
  return "ready";
}

export function useProtectedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: Query["_args"] | "skip",
): { data: Query["_returnType"] | undefined } & QueryHookMetadata {
  const { phase, canRunProtectedQueries } = useAuthReadiness();
  const shouldRun = canRunProtectedQueries && args !== "skip";

  // Cast to `never` to satisfy Convex's exact generic constraint.
  // Our wrapper accepts the base FunctionReference type; the cast bridges
  // the generic type gap without widening to `any`.
  const data = useQuery(
    query as never,
    shouldRun ? (args as never) : "skip",
  ) as Query["_returnType"] | undefined;
  const settlement = getSettlementState({
    phase,
    queryEnabled: shouldRun,
    hasData: data !== undefined || args === "skip",
  });

  return {
    data,
    phase,
    isDeferred: args !== "skip" && !canRunProtectedQueries,
    isReady:
      canRunProtectedQueries && (args === "skip" || data !== undefined),
    isAnonymous: phase === "anonymous",
    settlement,
  };
}

export function useOptionalAuthQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: Query["_args"] | "skip",
): { data: Query["_returnType"] | undefined } & QueryHookMetadata {
  const { phase } = useAuthReadiness();
  const shouldRun = phase === "authenticated" && args !== "skip";

  const data = useQuery(
    query as never,
    shouldRun ? (args as never) : "skip",
  ) as Query["_returnType"] | undefined;
  const settlement = getSettlementState({
    phase,
    queryEnabled: shouldRun,
    hasData: data !== undefined || args === "skip",
  });

  return {
    data,
    phase,
    isDeferred: args !== "skip" && phase !== "authenticated",
    isReady: phase === "authenticated" && (args === "skip" || data !== undefined),
    isAnonymous: phase === "anonymous",
    settlement,
  };
}

type ProtectedPaginatedResult<Query extends PaginatedQueryReference> = {
  results: PaginatedQueryItem<Query>[];
  status: UsePaginatedQueryReturnType<Query>["status"] | "Deferred";
  isLoading: boolean;
  loadMore: (numItems: number) => void;
  isInitialLoading: boolean;
  hasLoadedFirstPage: boolean;
  isSettled: boolean;
} & QueryHookMetadata;

/** A paginated query that waits for sign-in, run by `usePaginated`. */
function protectedPaginatedQuery(usePaginated: typeof usePaginatedQuery) {
  return function useProtectedPaginated<Query extends PaginatedQueryReference>(
    query: Query,
    args: PaginatedQueryArgs<Query> | "skip",
    options: { initialNumItems: number },
  ): ProtectedPaginatedResult<Query> {
    const { phase, canRunProtectedQueries } = useAuthReadiness();
    const shouldRun = canRunProtectedQueries && args !== "skip";

    const paginated = usePaginated(
      query as never,
      shouldRun ? (args as never) : "skip",
      options,
    ) as UsePaginatedQueryReturnType<Query>;
    const loadMoreNoop = useCallback((_numItems: number) => {
      // Intentional noop while query is deferred.
    }, []);

    const isAnonymous = phase === "anonymous";
    const disabledByCaller = args === "skip";
    const deferredForAuth = !disabledByCaller && !canRunProtectedQueries;

    if (disabledByCaller || deferredForAuth) {
      const settlement = getSettlementState({
        phase,
        queryEnabled: shouldRun,
        hasData: disabledByCaller,
      });
      return {
        results: [] as PaginatedQueryItem<Query>[],
        status: "Deferred",
        isLoading: false,
        loadMore: loadMoreNoop,
        isInitialLoading: false,
        hasLoadedFirstPage: disabledByCaller,
        isSettled: settlement === "ready",
        phase,
        isDeferred: deferredForAuth,
        isReady: canRunProtectedQueries,
        isAnonymous,
        settlement,
      };
    }

    const hasLoadedFirstPage = paginated.status !== "LoadingFirstPage";
    const settlement = getSettlementState({
      phase,
      queryEnabled: true,
      hasData: hasLoadedFirstPage,
    });

    return {
      ...paginated,
      isInitialLoading: !hasLoadedFirstPage,
      hasLoadedFirstPage,
      isSettled: settlement === "ready",
      phase,
      isDeferred: false,
      isReady: hasLoadedFirstPage,
      isAnonymous,
      settlement,
    };
  };
}

// Each hook is looked up when it runs, not when this module loads, as before.
export const useProtectedPaginatedQuery = protectedPaginatedQuery(((...args) => usePaginatedQuery(...args)) as typeof usePaginatedQuery);
/**
 * For queries paged with convex-helpers streams: their pages hold their place only when
 * the hook pins each page's end cursor, which convex-helpers' hook does.
 */
export const useProtectedStreamPaginatedQuery = protectedPaginatedQuery(((...args) => useStreamPaginatedQuery(...args)) as typeof usePaginatedQuery);
