"use client";

import useSWR from "swr";
import { CITATION_FORMATS, type CitationStyle } from "./formats";
import { loadCitationStyles } from "./styles";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const usePreference = create<{ id: string; setId: (id: string) => void }>()(
  persist((set) => ({ id: "apa", setId: (id) => set({ id }) }), {
    name: "citation-style",
  }),
);

/** Store the ID only so saved preferences use the current catalog and asset hashes. */
export function useCitationStyle() {
  const { id, setId } = usePreference();
  const common = CITATION_FORMATS.find((style) => style.id === id);
  const { data, error, mutate } = useSWR(
    common ? null : "citation-styles",
    loadCitationStyles,
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
  const style: CitationStyle | undefined =
    common ??
    (data
      ? (data.find((style) => style.id === id) ?? CITATION_FORMATS[0])
      : undefined);
  return {
    style,
    setStyle: (next: CitationStyle) => setId(next.id),
    error,
    retry: () => {
      void mutate();
    },
  };
}
