"use server";
import { z } from "zod";
import client from "@/lib/openalex";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import type { OpenAlexMatch } from "@/components/authors/types";
import type { Author } from "@sickrin/openalex-sdk/dist/src/types/author";

function match(author: Author): OpenAlexMatch {
  return {
    id: author.id.replace("https://openalex.org/", ""),
    name: author.display_name ?? author.id,
    affiliation: author.last_known_institutions?.map(institution => institution.display_name).join(", ") ?? author.last_known_institution?.display_name ?? "",
    topics: author.x_concepts?.slice(0, 3).map(topic => topic.display_name).join(", ") ?? "",
    works: [],
  };
}

export async function searchProfileAuthors(search: string) {
  const query = search.trim().slice(0, 200).replace(/^https:\/\/openalex.org\//, "");
  if (!query) return [];
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  if (/^A\d+$/.test(query)) return [match(await client.author(query))];
  const authors = await client.authors({search: query, perPage: 10});
  return authors.results.map(match);
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
