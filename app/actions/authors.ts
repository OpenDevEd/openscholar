"use server";
import { z } from "zod";
import client from "@/lib/openalex";
import { lookupRequests, readOpenAlexAuthorTopics, searchOpenAlex, topicNames } from "@/lib/openalex/lookup";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import type { OpenAlexMatch } from "@/components/authors/types";
import type { Author } from "@sickrin/openalex-sdk/dist/src/types/author";

// OpenAlex sends an author's topics; the SDK's type still has only the concepts they replaced.
function match(author: Author & { topics?: { display_name: string }[] | null }): OpenAlexMatch {
  return {
    id: author.id.replace("https://openalex.org/", ""),
    name: author.display_name ?? author.id,
    affiliation: author.last_known_institutions?.map(institution => institution.display_name).join(", ") ?? author.last_known_institution?.display_name ?? "",
    topics: topicNames(author.topics),
    works: [],
  };
}

/** Authors to link a profile to: the filters' own lookup, which also takes a pasted ID, with each author's topics. */
export async function searchProfileAuthors(search: string) {
  const query = search.trim().slice(0, 200).replace(/^https:\/\/openalex.org\//, "");
  if (!query) return [];
  const limited = await spendOpenAlexRequests(lookupRequests("authors") + 1);
  if (limited) return limited;
  const authors = await searchOpenAlex("authors", query);
  const topics = authors.length ? await readOpenAlexAuthorTopics(authors.map(author => author.id)) : {};
  return authors.map((author): OpenAlexMatch => ({id: author.id, name: author.name, affiliation: author.detail ?? "", topics: topics[author.id] ?? "", works: []}));
}

export async function readProfileAuthor(id: string) {
  if (!/^A\d+$/.test(id)) throw new Error("Invalid OpenAlex author");
  const limited = await spendOpenAlexRequests(2);
  if (limited) return limited;
  const [author, works] = await Promise.all([
    client.author(id), client.works({filter: {authorships: {author: {id}}}, perPage: 2, AbstractArrayToString: true}),
  ]);
  return {...match(author), works: works.results.map(work => work.title ?? work.id)};
}

export async function readProfileAuthorWorks(id: string, page: number) {
  if (!/^A\d+$/.test(id) || !Number.isInteger(page) || page < 1 || page > 1000) throw new Error("Invalid author page");
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const response = await client.works({filter: {authorships: {author: {id}}}, page, perPage: 10, AbstractArrayToString: true, sortBy: {field: "publication_date", order: "desc"}});
  const goals = z.array(z.object({id: z.string(), display_name: z.string(), score: z.number()})).optional();
  return {...response, results: response.results.map(({sustainable_development_goals, ...work}) => ({...work, sustainable_development_goals: goals.parse(sustainable_development_goals)}))};
}
