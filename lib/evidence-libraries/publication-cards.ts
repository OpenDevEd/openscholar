import { z } from "zod";
import { publicLibraryHeaders } from "./library-shield";

const cardSchema = z.object({
  key: z.string(), title: z.string().nullable(), itemType: z.string(),
  date: z.string().nullable(), numPages: z.string().nullable(),
  PDFCoverPageImage: z.string().nullable(),
  creators: z.array(z.object({name: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional()})).nullable(),
});
export type PublicationCard = z.infer<typeof cardSchema>;

/** A publication's card as its library's own API gives it, or null when the library has none by that key. */
export async function fetchPublicationCard(libraryId: string, itemKey: string, baseUrl: string): Promise<PublicationCard | null> {
  const url = new URL(`/api/item/${encodeURIComponent(itemKey)}`, baseUrl);
  url.searchParams.set("view", "card");
  const response = await fetch(url, {cache: "no-store", headers: publicLibraryHeaders("application/json"), signal: AbortSignal.timeout(10000)});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Publication metadata unavailable for ${libraryId}/${itemKey}: ${response.status}`);
  const body = await response.json();
  return cardSchema.parse(body.item);
}

/** A publication as a list shows it, from its card: its page is the one its library gives it. */
export const publicationOf = (card: PublicationCard, itemKey: string, libraryUrl: string) => ({
  title: card.title ?? "Untitled", type: card.itemType,
  year: card.date?.match(/\d{4}/)?.[0] ?? "",
  authors: (card.creators ?? []).map(creator => creator.name ?? [creator.firstName, creator.lastName].filter(Boolean).join(" ")).join(", "),
  cover: card.PDFCoverPageImage ?? undefined,
  pages: card.numPages && Number.isFinite(Number(card.numPages)) ? Number(card.numPages) : undefined,
  url: new URL(`/lib/${itemKey}`, libraryUrl).href,
});
