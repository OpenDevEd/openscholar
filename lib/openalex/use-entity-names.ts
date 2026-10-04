"use client";

import useSWR from "swr";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { usePersistedStoreReady } from "@/lib/use-persisted-store-ready";
import { unlessLimited, type OpenAlexLimited } from "./limited";

/**
 * Names for one kind of OpenAlex id (funders, authors) that this browser has seen, so a chip
 * starts with its name instead of its id: saved ones at once, others looked up once and then saved.
 */
export function createNameLookup(what: string, read: (ids: string[]) => Promise<Record<string, string> | OpenAlexLimited>) {
  const useStore = create<{ names: Record<string, string> }>()(
    persist(() => ({ names: {} }), { name: `${what}-names`, storage: createJSONStorage(() => localStorage) }),
  );

  /** Best effort: if the browser can't store them (full, blocked), they still last for this visit. */
  function remember(names: Record<string, string>) {
    try {
      useStore.setState((state) => ({ names: { ...state.names, ...names } }));
    } catch (error) {
      console.warn(`${what} names could not be saved in the browser`, error);
    }
  }

  function useNames(ids: readonly string[]): Record<string, string> {
    // Saved names only after the first browser render, so it matches the server's. Without browser storage
    // (blocked, or the server) the store only holds this visit's lookups, which start empty on both sides.
    const ready = usePersistedStoreReady(useStore) || !useStore.persist;
    const saved = useStore((state) => state.names);
    const missing = ready ? [...new Set(ids)].filter((id) => !saved[id]).sort() : [];
    useSWR(
      missing.length ? [`${what}-names`, ...missing] : null,
      async () => {
        const names = await unlessLimited(read(missing));
        remember(names);
        return names;
      },
      { revalidateOnFocus: false },
    );
    return ready ? saved : {};
  }

  return { remember, useNames };
}
