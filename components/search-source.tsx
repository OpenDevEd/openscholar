"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { LogoMark } from "@/components/logo";
import { usePersistedStoreReady } from "@/lib/use-persisted-store-ready";

/** The sources a site admin can pick from, with what pages call them. */
export const SEARCH_SOURCES = [
  { id: "openscholar", name: "Openscholar", icon: LogoMark },
  { id: "openalex", name: "OpenAlex", icon: OpenAlexIcon },
] as const;

export type SearchSourceId = (typeof SEARCH_SOURCES)[number]["id"];

// ponytail: mock only, so the admin picker and the labels can be tried without a server change. It starts on Openscholar so
// the new labels show first; the real build keeps the choice on the server and starts on OpenAlex.
const useMockSource = create<{ active: SearchSourceId }>()(
  persist(() => ({ active: "openscholar" as SearchSourceId }), { name: "mock-search-source", storage: createJSONStorage(() => localStorage) }),
);

export const pickSearchSource = (active: SearchSourceId) => useMockSource.setState({ active });

/** The source every search on the site reads from. */
export function useSearchSource() {
  const ready = usePersistedStoreReady(useMockSource) || !useMockSource.persist;
  const saved = useMockSource((state) => state.active);
  const id = ready ? saved : "openscholar";
  return SEARCH_SOURCES.find((source) => source.id === id)!;
}
