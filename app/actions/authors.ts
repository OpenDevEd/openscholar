"use server";
import { z } from "zod";
import client from "@/lib/openalex";
import { lookupRequests, readOpenAlexAuthor, readOpenAlexAuthorTopics, searchOpenAlex, topicNames } from "@/lib/openalex/lookup";
import { fetchOwnWorks } from "@/lib/openalex/read-works";
import { chosenSource } from "@/lib/search/active-source";
import { isOwnId, sourceForId, type SearchSource } from "@/lib/search/source";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import type { OpenAlexMatch } from "@/components/authors/types";
import type { OpenAlexLimited } from "@/lib/openalex/limited";
import type { Author } from "@sickrin/openalex-sdk/dist/src/types/author";

// OpenAlex sends an author's topics; the SDK's type still has only the concepts they replaced.
function match(author: Author & { topics?: { display_name: string }[] | null }): OpenAlexMatch {
  return {
    id: author.id.split("/").at(-1)!,
    name: author.display_name ?? author.id,
    affiliation: author.last_known_institutions?.map(institution => institution.display_name).join(", ") ?? author.last_known_institution?.display_name ?? "",
    topics: topicNames(author.topics),
    works: [],
  };
}

/** Authors to link a profile to: the filters' own lookup, which also takes a pasted ID, with each author's topics. */
export async function searchProfileAuthors(search: string, given?: SearchSource) {
  const query = search.trim().slice(0, 200).replace(/^https:\/\/(?:openalex\.org|openscholar\.ai)\//, "");
  if (!query) return [];
  const source = await chosenSource(given);
  const limited = await spendOpenAlexRequests(lookupRequests("authors") + 1);
  if (limited) return limited;
  const authors = await searchOpenAlex("authors", query, source);
  const topics = authors.length ? await readOpenAlexAuthorTopics(authors.map(author => author.id), source) : {};
  return authors.map((author): OpenAlexMatch => ({id: author.id, name: author.name, affiliation: author.detail ?? "", topics: topics[author.id] ?? "", works: []}));
}

const AUTHOR_ID = /^(?:A|OSA)\d+$/;

export async function readProfileAuthor(id: string, given?: SearchSource) {
  if (!AUTHOR_ID.test(id)) throw new Error("Invalid author");
  const source = sourceForId(id, await chosenSource(given));
  const limited = await spendOpenAlexRequests(2);
  if (limited) return limited;
  if (source === "openscholar") {
    const [author, works] = await Promise.all([readOpenAlexAuthor(id, source), fetchOwnWorks({filter: {authorships: {author: {id}}}}, {perPage: 2})]);
    if (!works.ok) throw new Error(works.message);
    return {...match(author as Author), works: works.data.results.map(work => work.title ?? work.id)};
  }
  const [author, works] = await Promise.all([
    client.author(id), client.works({filter: {authorships: {author: {id}}}, perPage: 2, AbstractArrayToString: true}),
  ]);
  return {...match(author), works: works.results.map(work => work.title ?? work.id)};
}

export type AuthorWorksPage = Exclude<Awaited<ReturnType<typeof readProfileAuthorWorks>>, OpenAlexLimited>;

/** A page of an author's papers, newest first, across the IDs of every record they go by, joined with `|` as the filter takes them. */
export async function readProfileAuthorWorks(id: string, page: number, given?: SearchSource) {
  const ids = id.split("|");
  if (!ids.every(one => AUTHOR_ID.test(one)) || !Number.isInteger(page) || page < 1 || page > 1000) throw new Error("Invalid author page");
  // OpenAlex can't read our index's IDs: while it's active it reads the rest, and our index only when there's nothing else.
  const active = await chosenSource(given);
  const readable = active === "openalex" ? ids.filter(one => !isOwnId(one)) : ids;
  const source = readable.length ? active : "openscholar";
  const authorIds = (readable.length ? readable : ids).join("|");
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const sortBy = {field: "publication_date", order: "desc"} as const;
  const goals = z.array(z.object({id: z.string(), display_name: z.string(), score: z.number()})).optional();
  const response = source === "openscholar"
    ? await fetchOwnWorks({filter: {authorships: {author: {id: authorIds}}}, sortBy}, {page, perPage: 10}).then((read) => {
      if (!read.ok) throw new Error(read.message);
      return read.data;
    })
    : await client.works({filter: {authorships: {author: {id: authorIds}}}, page, perPage: 10, AbstractArrayToString: true, sortBy});
  return {...response, results: response.results.map(({sustainable_development_goals, ...work}) => ({...work, sustainable_development_goals: goals.parse(sustainable_development_goals)}))};
}
