"use server";
import { fetchQuery } from "convex/nextjs";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AuthorPublication } from "@/components/authors/types";

const cardSchema = z.object({
  key: z.string(), title: z.string().nullable(), itemType: z.string(),
  date: z.string().nullable(), numPages: z.string().nullable(),
  PDFCoverPageImage: z.string().nullable(),
  creators: z.array(z.object({name: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional()})).nullable(),
});

const readCard = unstable_cache(async (libraryId: string, itemKey: string, baseUrl: string) => {
  const url = new URL(`/api/item/${encodeURIComponent(itemKey)}`, baseUrl);
  url.searchParams.set("view", "card");
  const response = await fetch(url, {cache: "no-store", signal: AbortSignal.timeout(10000)});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Publication metadata unavailable for ${libraryId}/${itemKey}: ${response.status}`);
  const body = await response.json();
  return cardSchema.parse(body.item);
}, ["author-publication-card"], {revalidate: 60});

export async function readAuthorPublications(profileId: Id<"authorProfiles">): Promise<{papers: AuthorPublication[]; unavailableCount: number}> {
  const references = await fetchQuery(api.authors.publications.list, {profileId});
  const cards = await Promise.allSettled(references.map(async reference => {
    const card = await readCard(reference.library.id, reference.itemKey, reference.library.url);
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
