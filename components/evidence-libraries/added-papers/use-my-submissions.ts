"use client";

import type { FunctionReturnType } from "convex/server";
import { useShallow } from "zustand/react/shallow";
import { api } from "@/convex/_generated/api";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import type { Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import { PUBLIC_PER_PAGE } from "@/lib/evidence-libraries/directory";
import { mySubmissions, useAddedPapers } from "@/lib/evidence-libraries/added-papers-mock";
import type { Community } from "../your-communities";

type Card = FunctionReturnType<typeof api.evidenceLibraries.directory.directory>["page"][number];

/** A public community's card as a row of yours draws it, with no role of yours on it. */
export const fromCard = (card: Card): Community => ({
  id: card._id,
  name: card.name,
  role: "viewer",
  faviconUrl: card.faviconUrl,
  address: card.address.replace(/^https?:\/\//, ""),
  owner: { name: card.owner.name ?? "", imageUrl: card.owner.imageUrl, kind: card.owner.kind, workspaceId: card.owner.workspaceId },
});

/**
 * Every paper you sent to a community, newest first. MOCK: the samples go to the newest three public communities,
 * read as the directory's first page is, so the Communities page's own first read stands in until the live one comes.
 */
export function useMySubmissions(preloaded?: Preloaded<typeof api.evidenceLibraries.directory.directory>) {
  const store = useAddedPapers(useShallow((state) => ({ byCommunity: state.byCommunity, communities: state.communities, withdrawn: state.withdrawn })));
  const live = useCursorPage(api.evidenceLibraries.directory.directory, { sort: "newest" }, PUBLIC_PER_PAGE, { open: true });
  const first = live.isLoading && preloaded ? preloadedQueryResult(preloaded).page : undefined;
  const cards = (first ?? live.items).slice(0, 3);
  return { submissions: mySubmissions(store, cards.map(fromCard)), isLoading: !first && live.isLoading };
}
