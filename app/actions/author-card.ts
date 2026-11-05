"use server";
import { fetchQuery } from "convex/nextjs";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
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
  last_known_institutions: z.array(z.object({ id: z.string().nullish(), display_name: z.string().nullish(), country_code: z.string().nullish() })).nullish(),
  topics: z.array(z.object({ id: z.string(), display_name: z.string(), count: z.number().nullish() })).nullish(),
});

type AuthorRecord = z.infer<typeof authorSchema>;

export type AuthorCard = {
  id: string;
  name: string;
  orcid: string | null;
  works: number;
  citations: number;
  hIndex: number | null;
  institution: { id: string | null; name: string; country: string | null } | null;
  /** The author's top topics, with how many of their papers each holds, most first. */
  topics: { id: string; name: string; papers: number }[];
  /** The OpenAlex record our index pairs this one with. */
  paired: string | null;
  /** Every ID this person goes by, so that holding any of them is holding them. */
  records: string[];
  /** The hand-made profile that links this author, when one does. */
  profileId: string | null;
};

/** Every record our index pairs with an OpenAlex author: the one person, split. */
async function readPairedRecords(id: string) {
  const response = await openAlexFetch(searchUrl("openscholar", "authors", { filter: `openalex:${id}`, "per-page": "50" }), { timeoutMs: 10_000 } as RequestInit & { timeoutMs: number });
  if (!response.ok) throw new Error(`Author ${id} returned ${response.status}`);
  // The filter also finds records paired with someone else, whose name is close: they aren't this person.
  return indexPageSchema.parse(await response.json()).results.filter((record) => record.ids?.openalex && lastPart(record.ids.openalex) === id);
}

/** One person from their records: the largest speaks for them, and their counts and topics are added up. */
function wholePerson(records: AuthorRecord[]): AuthorRecord {
  const largest = records.reduce((best, record) => ((record.works_count ?? 0) > (best.works_count ?? 0) ? record : best));
  const topics = new Map<string, { id: string; display_name: string; count: number }>();
  for (const topic of records.flatMap((record) => record.topics ?? [])) {
    const known = topics.get(topic.id);
    topics.set(topic.id, { id: topic.id, display_name: topic.display_name, count: (known?.count ?? 0) + (topic.count ?? 0) });
  }
  return {
    ...largest,
    orcid: records.find((record) => record.orcid)?.orcid ?? null,
    works_count: records.reduce((sum, record) => sum + (record.works_count ?? 0), 0),
    cited_by_count: records.reduce((sum, record) => sum + (record.cited_by_count ?? 0), 0),
    // ponytail: the largest record's h-index, a floor for the person's. The true one takes reading their papers' citations together, too much for a hover card.
    summary_stats: { h_index: Math.max(...records.map((record) => record.summary_stats?.h_index ?? 0)) },
    topics: [...topics.values()].sort((a, b) => b.count - a.count),
  };
}

/** How many of an author's topics a card lists. */
const TOP_TOPICS = 3;

/** What an author's card and automatic page show, from the source that holds them and the author profiles. */
export async function readAuthorCard(id: string, given?: SearchSource) {
  if (!isAuthorId(id)) throw new Error("Invalid author");
  const source = sourceForId(id, await chosenSource(given));
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const records = source === "openscholar" && id.startsWith("A") ? await readPairedRecords(id) : null;
  const response = records ? null : await openAlexFetch(searchUrl(source, `authors/${id}`, {}), { timeoutMs: 10_000 } as RequestInit & { timeoutMs: number });
  // The source doesn't know them, which a page says differently from a read that failed.
  if (records?.length === 0 || response?.status === 404) return null;
  if (response && !response.ok) throw new Error(`Author ${id} returned ${response.status}`);
  const author = records ? wholePerson(records) : authorSchema.parse(await response!.json());
  const institution = author.last_known_institutions?.[0];
  const paired = author.ids?.openalex ? lastPart(author.ids.openalex) : null;
  // The others split from this person, whichever of them this page opened from, and whichever source is on: a profile may hold any of them. The card stands without them.
  const pairedId = id.startsWith("A") ? id : paired;
  const split = records ?? (pairedId && !(await spendOpenAlexRequests()) ? await readPairedRecords(pairedId).catch((error) => {
    console.error("[authors] couldn't read an author's paired records", id, error);
    return [];
  }) : []);
  const known = [...new Set([id, lastPart(author.id), ...(paired ? [paired] : []), ...split.map((record) => lastPart(record.id))])];
  return {
    id,
    name: author.display_name,
    orcid: author.orcid?.replace("https://orcid.org/", "") ?? null,
    works: author.works_count ?? 0,
    citations: author.cited_by_count ?? 0,
    hIndex: author.summary_stats?.h_index ?? null,
    institution: institution?.display_name ? { id: institution.id ? lastPart(institution.id) : null, name: institution.display_name, country: institution.country_code ?? null } : null,
    topics: (author.topics ?? []).slice(0, TOP_TOPICS).map((topic) => ({ id: lastPart(topic.id), name: topic.display_name, papers: topic.count ?? 0 })),
    paired,
    records: known,
    // The card stands without it: it only says where the author's page goes.
    profileId: await fetchQuery(api.authors.links.profileFor, { ids: known }).catch((error) => {
      console.error("[authors] couldn't look up an author's profile", id, error);
      return null;
    }),
  } satisfies AuthorCard;
}

export type IndexAuthor = { id: string; name: string; institution: string | null; country: string | null; works: number; citations: number; largest: number };

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
  // A pasted ID is that one person, whom the search by name doesn't find.
  const pasted = (query.includes("/") ? query.replace(/\/$/, "").split("/").at(-1)! : query).toUpperCase();
  if (isAuthorId(pasted)) {
    if (page > 1) return { authors: [] as IndexAuthor[], more: false };
    const card = await readAuthorCard(pasted, source);
    if (card && !("id" in card)) return card;
    return {
      authors: card ? [{ id: card.paired ?? card.id, name: card.name, institution: card.institution?.name ?? null, country: card.institution?.country ?? null, works: card.works, citations: card.citations, largest: card.works }] : [],
      more: false,
    };
  }
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
    const works = author.works_count ?? 0;
    // A person's records on this page add up, and the largest speaks for them.
    const speaks = !known || works > known.largest;
    people.set(id, {
      id,
      name: speaks ? author.display_name : known.name,
      institution: speaks ? institution?.display_name ?? null : known.institution,
      country: speaks ? institution?.country_code ?? null : known.country,
      works: (known?.works ?? 0) + works,
      citations: (known?.citations ?? 0) + (author.cited_by_count ?? 0),
      largest: Math.max(known?.largest ?? 0, works),
    });
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
