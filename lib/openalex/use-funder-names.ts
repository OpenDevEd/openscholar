"use client";

import useSWR from "swr";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { readFunderNames } from "@/app/actions/funders";
import { usePersistedStoreReady } from "@/lib/use-persisted-store-ready";

/** Funder names this browser has seen, so a funder chip starts with its name instead of its ID. */
const useFunderNameStore = create<{ names: Record<string, string> }>()(
  persist(() => ({ names: {} }), { name: "funder-names", storage: createJSONStorage(() => localStorage) }),
);

export function rememberFunderNames(names: Record<string, string>) {
  useFunderNameStore.setState((state) => ({ names: { ...state.names, ...names } }));
}

/** Names for funder ids such as F4320311904: saved ones at once, others looked up once and then saved. */
export function useFunderNames(ids: readonly string[]): Record<string, string> {
  // Saved names only after the first browser render, so it matches the server's.
  const ready = usePersistedStoreReady(useFunderNameStore);
  const saved = useFunderNameStore((state) => state.names);
  const missing = ready ? [...new Set(ids)].filter((id) => !saved[id]).sort() : [];
  useSWR(
    missing.length ? ["funder-names", ...missing] : null,
    async () => {
      const names = await readFunderNames(missing);
      rememberFunderNames(names);
      return names;
    },
    { revalidateOnFocus: false },
  );
  return ready ? saved : {};
}
