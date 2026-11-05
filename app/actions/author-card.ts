"use server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { cookies } from "next/headers";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { MOCK_LINKS_COOKIE, parseLinks } from "@/lib/authors/mock-links";
import { isAuthorId } from "@/lib/openalex/author-filter";
import { openAlexFetch } from "@/lib/openalex/fetch";
import { searchUrl } from "@/lib/openalex/request-url";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { chosenSource } from "@/lib/search/active-source";
import { sourceForId, type SearchSource } from "@/lib/search/source";

const lastPart = (id: string) => id.split("/").at(-1)!;

const authorSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  orcid: z.string().nullish(),
  works_count: z.number().nullish(),
  cited_by_count: z.number().nullish(),
  summary_stats: z.object({ h_index: z.number().nullish() }).nullish(),
  ids: z.object({ openalex: z.string().nullish() }).nullish(),
  last_known_institutions: z.array(z.object({ display_name: z.string().nullish(), country_code: z.string().nullish() })).nullish(),
  topics: z.array(z.object({ id: z.string(), display_name: z.string(), count: z.number().nullish() })).nullish(),
});

export type AuthorCard = {
  id: string;
  name: string;
  orcid: string | null;
  works: number;
  citations: number;
  hIndex: number | null;
  institution: { name: string; country: string | null } | null;
  /** The author's top topics, with how many of their papers each holds, most first. */
  topics: { id: string; name: string; papers: number }[];
  /** The OpenAlex record our index pairs this one with. */
  paired: string | null;
  /** The hand-made profile that links this author, when one does. */
  profileId: string | null;
};

/**
 * The hand-made profile linked to an author, by any of their IDs.
 * ponytail: mock lookup. It finds a profile among those named like the author, and takes extra links from a cookie, since
 * the mock changes no tables. The real build has a table of a profile's author IDs, with an index on the ID.
 */
async function linkedProfile(ids: string[], name: string) {
  const links = parseLinks((await cookies()).get(MOCK_LINKS_COOKIE)?.value);
  const linked = ids.flatMap((id) => links[id] ?? [])[0];
  if (linked) return linked;
  const session = await auth();
  const token = (await session.getToken({ template: "convex" })) ?? undefined;
  const rows = await fetchQuery(api.authors.profiles.list, { search: name, paginationOpts: { cursor: null, numItems: 30 } }, { token }).catch(() => null);
  return rows?.page.find((profile) => ids.includes(profile.openalex))?._id ?? null;
}

/** How many of an author's topics a card lists. */
const TOP_TOPICS = 3;

/** What an author's card and automatic page show, from the source that holds them and the author profiles. */
export async function readAuthorCard(id: string, given?: SearchSource) {
  if (!isAuthorId(id)) throw new Error("Invalid author");
  const source = sourceForId(id, await chosenSource(given));
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const response = await openAlexFetch(searchUrl(source, `authors/${id}`, {}), { timeoutMs: 10_000 } as RequestInit & { timeoutMs: number });
  if (!response.ok) throw new Error(`Author ${id} returned ${response.status}`);
  const author = authorSchema.parse(await response.json());
  const institution = author.last_known_institutions?.[0];
  const paired = author.ids?.openalex ? lastPart(author.ids.openalex) : null;
  return {
    id,
    name: author.display_name,
    orcid: author.orcid?.replace("https://orcid.org/", "") ?? null,
    works: author.works_count ?? 0,
    citations: author.cited_by_count ?? 0,
    hIndex: author.summary_stats?.h_index ?? null,
    institution: institution?.display_name ? { name: institution.display_name, country: institution.country_code ?? null } : null,
    topics: (author.topics ?? []).slice(0, TOP_TOPICS).map((topic) => ({ id: lastPart(topic.id), name: topic.display_name, papers: topic.count ?? 0 })),
    paired,
    profileId: await linkedProfile([...new Set([id, lastPart(author.id), ...(paired ? [paired] : [])])], author.display_name),
  } satisfies AuthorCard;
}

export type IndexAuthor = { id: string; name: string; institution: string | null; country: string | null; works: number; citations: number; records: number };

const indexPageSchema = z.object({ meta: z.object({ count: z.number().nullish() }).nullish(), results: z.array(authorSchema) });
const INDEX_PAGE = 25;

/**
 * Authors in the active source that match a search, a page at a time. Our index splits a person into several records, so
 * the ones paired with one OpenAlex author become one row, which goes by that author's ID and shows their largest record.
 */
export async function searchIndexAuthors(search: string, page: number, given?: SearchSource) {
  const query = search.trim().slice(0, 200);
  if (!query || !Number.isInteger(page) || page < 1 || page > 200) return { authors: [] as IndexAuthor[], more: false };
  const source = await chosenSource(given);
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const response = await openAlexFetch(searchUrl(source, "authors", { search: query, "per-page": String(INDEX_PAGE), page: String(page) }), { timeoutMs: 12_000 } as RequestInit & { timeoutMs: number });
  if (!response.ok) throw new Error(`Author search returned ${response.status}`);
  const body = indexPageSchema.parse(await response.json());
  const people = new Map<string, IndexAuthor>();
  for (const author of body.results) {
    const id = lastPart(author.ids?.openalex ?? author.id);
    const known = people.get(id);
    const institution = author.last_known_institutions?.[0];
    const row: IndexAuthor = {
      id,
      name: author.display_name,
      institution: institution?.display_name ?? null,
      country: institution?.country_code ?? null,
      works: author.works_count ?? 0,
      citations: author.cited_by_count ?? 0,
      records: (known?.records ?? 0) + 1,
    };
    people.set(id, !known || row.works > known.works ? row : { ...known, records: row.records });
  }
  return { authors: [...people.values()], more: page * INDEX_PAGE < (body.meta?.count ?? 0) };
}

const institutionSchema = z.object({
  display_name: z.string(),
  country_code: z.string().nullish(),
  type: z.string().nullish(),
  works_count: z.number().nullish(),
  cited_by_count: z.number().nullish(),
  homepage_url: z.string().nullish(),
});

export type InstitutionCard = { name: string; country: string | null; type: string | null; works: number; citations: number; homepage: string | null };

/** What an institution's card shows. */
export async function readInstitutionCard(id: string, given?: SearchSource) {
  if (!/^I\d+$/.test(id)) throw new Error("Invalid institution");
  const source = await chosenSource(given);
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const response = await openAlexFetch(searchUrl(source, `institutions/${id}`, {}), { timeoutMs: 10_000 } as RequestInit & { timeoutMs: number });
  if (!response.ok) throw new Error(`Institution ${id} returned ${response.status}`);
  const institution = institutionSchema.parse(await response.json());
  return {
    name: institution.display_name,
    country: institution.country_code ?? null,
    type: institution.type ?? null,
    works: institution.works_count ?? 0,
    citations: institution.cited_by_count ?? 0,
    homepage: institution.homepage_url ?? null,
  } satisfies InstitutionCard;
}
