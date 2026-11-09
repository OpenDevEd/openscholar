"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { copyOf, type CommunityCopy } from "@/lib/papers/community-copies";
import { MAX_LOCATIONS } from "@/lib/topics/publications";

const FIRST_PAGE = { cursor: null, numItems: MAX_LOCATIONS };

/**
 * The paper's records in communities as they change: one published while the page is open joins the list, and a
 * record's PDF and cover arrive once its community sends them. Until both of its keys answer, the list the server read
 * stands.
 */
export function useLiveCopies(initial: CommunityCopy[], keys: readonly string[]) {
  const first = useQuery(api.topics.publications.listLocations, keys[0] ? { groupKey: keys[0], paginationOpts: FIRST_PAGE } : "skip");
  const second = useQuery(api.topics.publications.listLocations, keys[1] ? { groupKey: keys[1], paginationOpts: FIRST_PAGE } : "skip");
  if ((keys[0] && !first) || (keys[1] && !second)) return initial;
  const read = new Map(initial.map((copy) => [copy.id, copy]));
  const live = new Map([...(first?.page ?? []), ...(second?.page ?? [])].map((location) => [location.id, location]));
  // Named, placed and with its PDF and cover as the community says now; a runtime that doesn't say keeps the server's.
  return [...live.values()].map((location) => {
    const sent = location.metadata.pdf;
    return sent !== undefined
      ? { ...copyOf(location), pdf: sent?.url ?? null, cover: sent?.cover ?? null }
      : { ...copyOf(location), pdf: read.get(location.id)?.pdf ?? null, cover: read.get(location.id)?.cover ?? null };
  });
}
