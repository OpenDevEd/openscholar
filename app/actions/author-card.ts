"use server";
import { fetchQuery } from "convex/nextjs";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { AUTHOR_IDS_LOOKED_UP } from "@/convex/authors/validators";
import { isAuthorId } from "@/lib/openalex/author-filter";
import { authorPageSchema, authorRecordSchema, readPairedRecords } from "@/lib/openalex/author-record";
import { wholePerson } from "@/lib/openalex/whole-person";
import { openAlexFetch } from "@/lib/openalex/fetch";
import { searchUrl } from "@/lib/openalex/request-url";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import type { IndexAuthor } from "@/lib/authors/example-authors";
import { chosenSource } from "@/lib/search/active-source";
import { sourceForId, type SearchSource } from "@/lib/search/source";

const lastPart = (id: string) => id.split("/").at(-1)!;

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
  const record = records ? wholePerson(records) : authorRecordSchema.parse(await response!.json());
  const paired = record.ids?.openalex ? lastPart(record.ids.openalex) : null;
  // The others split from this person, whichever of them this page opened from, and whichever source is on: a profile may hold any of them. The card stands without them.
  const pairedId = id.startsWith("A") ? id : paired;
  const split = records ?? (pairedId && !(await spendOpenAlexRequests()) ? await readPairedRecords(pairedId).catch((error) => {
    console.error("[authors] couldn't read an author's paired records", id, error);
    return [];
  }) : []);
  // ponytail: a person with more records than a lookup takes is checked by the first of them; none seen tonight has over 50.
  const known = [...new Set([id, lastPart(record.id), ...(paired ? [paired] : []), ...split.map((one) => lastPart(one.id))])].slice(0, AUTHOR_IDS_LOOKED_UP);
  // Any of their IDs reads the one person.
  const author = source === "openscholar" && !records && split.length ? wholePerson(split) : record;
  const institution = author.last_known_institutions?.[0];
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
  const body = authorPageSchema.parse(await response.json());
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
