import "server-only";
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { fetchOwnWorks, readOpenAlexWorks } from "@/lib/openalex/read-works";
import { MAX_LOCATIONS } from "@/lib/topics/publications";
import { normalizeDoi } from "@/lib/topics/identity";
import { fetchPublicationPdf } from "@/lib/evidence-libraries/publication-cards";
import type { SimilarPaper } from "@/app/actions/similar";
import type { PaperResult } from "@/lib/types/search.types";
import { copyOf, type CommunityCopy } from "./community-copies";

/** How long a paper page reuses what it read: a paper's record barely changes, and crawlers read many pages once each. */
const DAY = 60 * 60 * 24;

// ponytail: paper pages read our index without the per-visitor request limits, so crawlers can read them; each ID is
// read once a day at most, and an ID that isn't ours costs one read. Rate-limit at Cloudflare if someone walks the IDs.

/** A paper as our index holds it, by our ID or its OpenAlex ID. Null when our index has none. */
export const readPaperForPage = unstable_cache(
  async (id: string): Promise<PaperResult | null> => {
    const read = await readOpenAlexWorks({ filter: { openalex_id: id } as never, cursor: "*", perPage: 1 }, "openscholar");
    return (read.results[0] as PaperResult | undefined) ?? null;
  },
  ["paper-page"],
  { revalidate: DAY },
);

/** A paper in one of the page's lists. Named by our own ID, so its row links straight to its page instead of through a redirect. */
const rowOf = (work: PaperResult): SimilarPaper => ({
  id: ((work as { openscholar_id?: string }).openscholar_id ?? work.id).split("/").at(-1)!,
  title: work.title ?? work.display_name ?? "",
  year: work.publication_year ?? null,
  citations: work.cited_by_count ?? 0,
  doi: work.doi ?? null,
});

/** How many rows each of the page's lists shows; the rest are a search away. */
export const LIST_ROWS = 8;

/** The papers closest in meaning to it, for the page's list. Empty when our index can't say. */
export const readSimilarForPage = unstable_cache(
  async (id: string): Promise<SimilarPaper[]> => {
    const answer = await fetchOwnWorks({ filter: { is_retracted: false } as never }, { perPage: LIST_ROWS }, { similar_to: id });
    // Thrown, not cached as an empty list: the last good list stays until a read succeeds.
    if (!answer.ok) throw new Error(answer.message);
    return answer.data.results.map((work) => rowOf(work as PaperResult));
  },
  ["paper-page-similar"],
  { revalidate: DAY },
);

/** The most cited of the papers it cites, in one read of our index. */
export const readReferencesForPage = unstable_cache(
  async (ids: string[]): Promise<SimilarPaper[]> => {
    if (!ids.length) return [];
    const read = await readOpenAlexWorks({ filter: { openalex_id: ids.join("|") } as never, cursor: "*", perPage: LIST_ROWS, sortBy: { field: "cited_by_count", order: "desc" } as never }, "openscholar");
    return read.results.map((work) => rowOf(work as PaperResult));
  },
  ["paper-page-references"],
  { revalidate: DAY },
);

/** The paper as OpenAlex holds it, for what our index leaves out: authors' institutions and ORCID iDs, keywords, citations by year, copies, grants, MeSH. */
export const readOpenAlexForPage = unstable_cache(
  async (work: string): Promise<PaperResult | null> => {
    const read = await readOpenAlexWorks({ filter: { openalex_id: work } as never, cursor: "*", perPage: 1 }, "openalex");
    return (read.results[0] as PaperResult | undefined) ?? null;
  },
  ["paper-page-openalex"],
  { revalidate: DAY },
);


/** The keys a paper's records in communities are found by, as topic pages find them: its DOI's and its OpenAlex work's. */
export const copyKeysOf = (doi: string | null, openalexId: string | null) =>
  [normalizeDoi(doi) && `doi:${normalizeDoi(doi)}`, openalexId && `openalex:${openalexId}`].filter((key): key is string => !!key);

/**
 * A community record's PDF and the picture of its first page: the slow part, read from the community, so kept a minute.
 * The community adds them after it publishes the record, so a reload soon after shows them.
 */
const readCopyPdf = unstable_cache(
  async (libraryId: string, itemKey: string, url: string) => fetchPublicationPdf(libraryId, itemKey, url),
  ["paper-page-copy-pdf"],
  { revalidate: 60 },
);

/**
 * The paper's published records in public Evidence Communities, read as they stand, so one just published shows on the
 * next load. Only each record's PDF is kept, for a minute.
 */
export async function readCommunityCopies(doi: string | null, openalexId: string | null): Promise<CommunityCopy[]> {
  const pages = await Promise.all(copyKeysOf(doi, openalexId).map((groupKey) => fetchQuery(api.topics.publications.listLocations, { groupKey, paginationOpts: { cursor: null, numItems: MAX_LOCATIONS } })));
  // ponytail: a paper's first 100 copies per key, as topic pages read them. One with more says so in the logs; page through when a paper ever has that many.
  if (pages.some((page) => !page.isDone)) console.error("[paper page] a paper has more community copies than one page lists", { doi, openalexId, listed: MAX_LOCATIONS });
  const locations = [...new Map(pages.flatMap((page) => page.page).map((location) => [location.id, location])).values()];
  // The community says each record's PDF and the picture of its first page; one from a runtime that doesn't is asked.
  // One that can't be read just has neither.
  const pdfs = await Promise.allSettled(locations.map((location) => (location.metadata.pdf !== undefined ? location.metadata.pdf : readCopyPdf(location.library.id, location.itemKey, location.library.url))));
  return locations.map((location, index) => {
    const read = pdfs[index]!;
    if (read.status === "rejected") console.error("[paper page] community record unavailable", { library: location.library.id, item: location.itemKey, error: read.reason });
    const pdf = read.status === "fulfilled" ? read.value : null;
    return { ...copyOf(location), pdf: pdf?.url ?? null, cover: pdf?.cover ?? null };
  });
}

/** The OpenAlex work a record of ours is paired with, bare, if any. */
export const openalexIdOf = (paper: PaperResult) => (paper.ids as { openalex?: string } | undefined)?.openalex?.split("/").at(-1) ?? null;
