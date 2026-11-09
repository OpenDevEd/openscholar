// MOCK (mock/publish-reports): the "Already published" check's search.
import { openAlexFetch } from "@/lib/openalex/fetch";
import { openAlexUrl } from "@/lib/openalex/request-url";
import type { Metadata } from "./types";

const plain = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const surnames = (m: Pick<Metadata, "authors">) => new Set(m.authors.map((a) => plain(a.name).split(" ").at(-1)).filter(Boolean));

/**
 * MOCK: the work as OpenAlex already has it, by its exact title or a sentence of its abstract. A title match needs an
 * author's surname, or the year and the very same title; a sentence of the abstract needs the surname or the year. The real check also searches our index and
 * our communities, which hold grey literature OpenAlex lacks.
 */
export async function alreadyPublished(m: Pick<Metadata, "title" | "abstract" | "date" | "authors">): Promise<{ title: string; url: string } | null> {
  const quoted = (s: string) => `"${s.replace(/[",:;()|[\]]/g, " ").slice(0, 200)}"`;
  const sentence = m.abstract.split(/(?<=[.!?])\s+/).find((s) => s.length > 80 && s.length < 260);
  // A title can be shared by unrelated works of the same year; a sentence of the abstract rarely is.
  const searches = [{ filter: `title.search:${quoted(m.title)}`, byTitle: true }, ...(sentence ? [{ filter: `title_and_abstract.search:${quoted(sentence)}`, byTitle: false }] : [])];
  const mine = surnames(m);
  const year = m.date.slice(0, 4);
  for (const { filter, byTitle } of searches) {
    try {
      const response = await openAlexFetch(openAlexUrl("works", { filter, select: "title,doi,id,publication_year,authorships", "per-page": "5" }), { timeoutMs: 12000 });
      if (!response.ok) throw new Error(`OpenAlex works ${response.status}`);
      const { results } = (await response.json()) as { results: Array<{ title: string; doi: string | null; id: string; publication_year: number; authorships: Array<{ author: { display_name: string } }> }> };
      const match = results.find((w) => {
        const sameAuthor = w.authorships.some((a) => mine.has(plain(a.author.display_name).split(" ").at(-1) ?? ""));
        const sameYear = String(w.publication_year) === year;
        return sameAuthor || (sameYear && (!byTitle || plain(w.title ?? "") === plain(m.title)));
      });
      if (match) return { title: match.title, url: match.doi ?? match.id };
    } catch (error) {
      console.error("[publish mock] already-published search failed", error);
    }
  }
  return null;
}
