"use server";
import { readPublicationCard } from "@/lib/evidence-libraries/publication-card";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AuthorPublication } from "@/components/authors/types";

export async function readAuthorPublications(profileId: Id<"authorProfiles">): Promise<{papers: AuthorPublication[]; unavailableCount: number}> {
  const references = await fetchQuery(api.authors.publications.list, {profileId});
  const cards = await Promise.allSettled(references.map(async reference => {
    const card = await readPublicationCard(reference.library.id, reference.itemKey, reference.library.url);
    if (!card) return null;
    return {
      id: reference.id, title: card.title ?? "Untitled", type: card.itemType,
      year: card.date?.match(/\d{4}/)?.[0] ?? "",
      authors: (card.creators ?? []).map(creator => creator.name ?? [creator.firstName, creator.lastName].filter(Boolean).join(" ")).join(", "),
      cover: card.PDFCoverPageImage ?? undefined,
      pages: card.numPages && Number.isFinite(Number(card.numPages)) ? Number(card.numPages) : undefined,
      url: new URL(`/lib/${reference.itemKey}`, reference.library.url).href,
      library: reference.library,
    } satisfies AuthorPublication;
  }));
  const papers: AuthorPublication[] = [];
  let unavailableCount = 0;
  for (const [index, result] of cards.entries()) {
    if (result.status === "rejected") {
      unavailableCount++;
      console.error("Author publication could not be loaded", {
        profileId, libraryId: references[index].library.id,
        itemKey: references[index].itemKey, error: result.reason,
      });
    } else if (result.value) papers.push(result.value);
  }
  return { papers, unavailableCount };
}
