"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { copyOf, type CommunityCopy } from "@/lib/papers/community-copies";
import { MAX_LOCATIONS } from "@/lib/topics/publications";

const FIRST_PAGE = { cursor: null, numItems: MAX_LOCATIONS };

/**
 * The paper's records in communities as they change: one published while the page is open joins the list. Until both
 * of its keys answer, the list the server read stands, with each record's PDF; a new one has none until the next load.
 */
export function useLiveCopies(initial: CommunityCopy[], keys: readonly string[]) {
  const first = useQuery(api.topics.publications.listLocations, keys[0] ? { groupKey: keys[0], paginationOpts: FIRST_PAGE } : "skip");
  const second = useQuery(api.topics.publications.listLocations, keys[1] ? { groupKey: keys[1], paginationOpts: FIRST_PAGE } : "skip");
  if ((keys[0] && !first) || (keys[1] && !second)) return initial;
  const read = new Map(initial.map((copy) => [copy.id, copy]));
  const live = new Map([...(first?.page ?? []), ...(second?.page ?? [])].map((location) => [location.id, location]));
  return [...live.values()].map((location) => read.get(location.id) ?? { ...copyOf(location), pdf: null, cover: null });
}
