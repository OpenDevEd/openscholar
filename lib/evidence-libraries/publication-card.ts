import "server-only";
import { unstable_cache } from "next/cache";
import { z } from "zod";

const cardSchema = z.object({
  key: z.string(), title: z.string().nullable(), itemType: z.string(),
  date: z.string().nullable(), numPages: z.string().nullable(),
  PDFCoverPageImage: z.string().nullable(),
  creators: z.array(z.object({name: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional()})).nullable(),
});

export const readPublicationCard = unstable_cache(async (libraryId: string, itemKey: string, baseUrl: string) => {
  const url = new URL(`/api/item/${encodeURIComponent(itemKey)}`, baseUrl);
  url.searchParams.set("view", "card");
  const response = await fetch(url, {cache: "no-store", signal: AbortSignal.timeout(10000)});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Publication metadata unavailable for ${libraryId}/${itemKey}: ${response.status}`);
  const body = await response.json();
  return cardSchema.parse(body.item);
}, ["evidence-library-publication-card"], {revalidate: 60});
