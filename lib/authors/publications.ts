import type { AuthorPublication } from "@/components/authors/types";
import { publicationOf, type PublicationCard } from "../evidence-libraries/publication-cards";

type Reference = { id: string; itemKey: string; library: { id: string; name: string; url: string } };
type ReadCard = (libraryId: string, itemKey: string, baseUrl: string) => Promise<PublicationCard | null>;
type ReadPdf = (libraryId: string, itemKey: string, baseUrl: string) => Promise<{ url: string; cover: string | null } | null>;

/**
 * A profile's publications as its page lists them, each read from its library's own card: one
 * a library no longer has is left out, and one it couldn't answer for is counted as unavailable.
 */
export async function authorPublicationsFrom(references: Reference[], readCard: ReadCard, profileId: string, readPdf?: ReadPdf): Promise<{papers: AuthorPublication[]; unavailableCount: number}> {
  const cards = await Promise.allSettled(references.map(async reference => {
    const card = await readCard(reference.library.id, reference.itemKey, reference.library.url);
    if (!card) return null;
    const shown = publicationOf(card, reference.itemKey, reference.library.url);
    // A card with no picture doesn't say whether its record has a PDF. Where the list draws covers (`readPdf`), the
    // record is asked; one that can't answer leaves it unknown, and the publication is listed all the same.
    const pdf = shown.cover || !readPdf ? undefined : await readPdf(reference.library.id, reference.itemKey, reference.library.url).catch(() => undefined);
    return { id: reference.id, ...shown, ...(pdf?.cover && { cover: pdf.cover }), ...(pdf !== undefined && { pdf: pdf && { url: pdf.url } }), library: reference.library } satisfies AuthorPublication;
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
