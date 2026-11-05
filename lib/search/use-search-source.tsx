"use client";

import { createContext, useContext } from "react";
import { useDbFlags } from "@/lib/feature-flags/provider";
import { SEARCH_SOURCE_FLAG, sourceFromFlag, type SearchSource } from "./source";

const Pinned = createContext<SearchSource | null>(null);

/** Everything inside searches this source whatever the site's is: a community's source dialog, which asks OpenAlex. */
export const PinSearchSource = Pinned.Provider;

/** The source this part of the page searches. It comes with the page's flags, so it's right from the first frame. */
export function useSearchSource(): SearchSource {
  const pinned = useContext(Pinned);
  const flags = useDbFlags();
  // ponytail: mock only, so the preview shows our index with the site's flag left alone.
  return pinned ?? (process.env.NEXT_PUBLIC_MOCK_SEARCH_SOURCE as SearchSource | undefined) ?? sourceFromFlag(flags?.find((flag) => flag.key === SEARCH_SOURCE_FLAG)?.enabled);
}
