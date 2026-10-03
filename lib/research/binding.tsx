"use client";

import { createContext, useContext } from "react";
import { useStore, type StoreApi, type UseBoundStore } from "zustand";
import type { SearchHistoryState, KeywordExpansionState, RatingsState } from "../store";
import type { ResearchSession } from "./session";

export type ResearchStores = {
  history: StoreApi<SearchHistoryState>;
  shortcuts: StoreApi<KeywordExpansionState>;
  ratings: StoreApi<RatingsState>;
};
export const ResearchContext = createContext<ResearchStores | null>(null);
/**
 * The signed-in account's session, which reads searches, ratings and shortcuts by ID, and
 * where its sign-in stands; no session signed out. The hooks in ./reads.ts read from it.
 */
export const SessionContext = createContext<{ session: ResearchSession | null; phase: "initializing" | "authenticated" | "anonymous" | "sync_error" }>({ session: null, phase: "anonymous" });
let active: ResearchStores | null = null;

/** Imperative export/search helpers use the same account as React subscribers. */
export function activateResearch(stores: ResearchStores | null) {
  active = stores;
  return () => { if (active === stores) active = null; };
}

export function bindResearchStore<S>(
  local: UseBoundStore<StoreApi<S>>, key: keyof ResearchStores,
): UseBoundStore<StoreApi<S>> {
  function useResearchStore(): S;
  function useResearchStore<T>(selector: (state: S) => T): T;
  function useResearchStore<T>(selector?: (state: S) => T): T | S {
    const stores = useContext(ResearchContext);
    const store = (stores?.[key] ?? local) as StoreApi<S>;
    return useStore(store, (state) => selector ? selector(state) : state);
  }
  return Object.assign(useResearchStore, local, {
    getState: () => (active?.[key] ?? local).getState(),
  }) as UseBoundStore<StoreApi<S>>;
}
