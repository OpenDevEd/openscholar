/**
 * FeatureFlagProvider
 * ===================
 * Accepts preloaded feature-flag data from an RSC (via `preloadQuery`)
 * and exposes it through React Context so every consumer gets the DB rows
 * on first render — no loading flash, no pop-in.
 *
 * `usePreloadedQuery` also resumes a live WebSocket subscription, so flags
 * stay reactive after the initial server-side snapshot.
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import type { api } from "@/convex/_generated/api";

type FlagRow = { key: string; enabled: boolean; minimumTier: number };
type FlagRows = FlagRow[];

const FeatureFlagContext = createContext<FlagRows | undefined>(undefined);

type Props = {
  preloadedFlags: Preloaded<typeof api.featureFlags.queries.getAll>;
  children: ReactNode;
};

export function FeatureFlagProvider({ preloadedFlags, children }: Props) {
  const flags = usePreloadedQuery(preloadedFlags) as FlagRows;
  return (
    <FeatureFlagContext.Provider value={flags}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

/**
 * Read the DB flag rows from context.
 * Returns `undefined` only if the provider is missing (should never happen).
 */
export function useDbFlags(): FlagRows | undefined {
  return useContext(FeatureFlagContext);
}
