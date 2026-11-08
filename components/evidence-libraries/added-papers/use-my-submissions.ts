"use client";

import type { FunctionReturnType } from "convex/server";
import { useShallow } from "zustand/react/shallow";
import { api } from "@/convex/_generated/api";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
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

/** Every paper you sent to a community, newest first. MOCK: the samples go to the first three public communities. */
export function useMySubmissions() {
  const store = useAddedPapers(useShallow((state) => ({ byCommunity: state.byCommunity, communities: state.communities, withdrawn: state.withdrawn })));
  const samples = useCursorPage(api.evidenceLibraries.directory.directory, { sort: "name" }, 3, { open: true });
  return { submissions: mySubmissions(store, samples.items.map(fromCard)), isLoading: samples.isLoading };
}
