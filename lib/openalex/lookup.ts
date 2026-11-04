import "server-only";
import { z } from "zod";
import type { SearchSource } from "../search/source";
import { openAlexFetch } from "./fetch";
import { searchUrl } from "./request-url";
import { autocompleteOptions, autocompleteParameters, sourceTypesParameters, withSourceTypes, type LookupEntity, type LookupOption } from "./autocomplete";

const namesSchema = z.object({
  results: z.array(z.object({ id: z.string(), display_name: z.string(), ids: z.object({ openalex: z.string().nullish() }).nullish() })),
});
const topicsSchema = z.object({
  results: z.array(z.object({ id: z.string(), topics: z.array(z.object({ display_name: z.string() })).nullish() })),
});

/** An author's three main research topics, comma separated, as OpenAlex lists them. */
export const topicNames = (topics?: readonly { display_name: string }[] | null) =>
  topics?.slice(0, 3).map((topic) => topic.display_name).join(", ") ?? "";

async function readOpenAlex(path: string, parameters: Record<string, string>, source: SearchSource): Promise<unknown> {
  const response = await openAlexFetch(searchUrl(source, path, parameters), { timeoutMs: 12000, next: { revalidate: 3600 } } as RequestInit & { timeoutMs: number });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("OpenAlex lookup failed", { path, status: response.status, body: body.slice(0, 500) });
    throw new Error(`OpenAlex ${path} unavailable: ${response.status}`);
  }
  return response.json();
}

/** How many OpenAlex requests a search for this kind of record makes: a source's type takes a second. */
export const lookupRequests = (entity: LookupEntity) => (entity === "sources" ? 2 : 1);

/** Records whose names start with the words typed, as OpenAlex's autocomplete finds them, with what tells them apart. */
export async function searchOpenAlex(entity: LookupEntity, query: string, source: SearchSource = "openalex"): Promise<LookupOption[]> {
  const options = autocompleteOptions(await readOpenAlex(`autocomplete/${entity}`, autocompleteParameters(query, entity, source), source));
  if (entity !== "sources" || !options.length) return options;
  return withSourceTypes(options, await readOpenAlex("sources", sourceTypesParameters(options.map((option) => option.id)), source));
}

/** Each author's main topics, which autocomplete leaves out. One request. */
export async function readOpenAlexAuthorTopics(ids: readonly string[], source: SearchSource = "openalex"): Promise<Record<string, string>> {
  const body = topicsSchema.parse(await readOpenAlex("authors", { filter: `openalex_id:${ids.join("|")}`, select: "id,topics", "per-page": "100" }, source));
  return Object.fromEntries(body.results.map((author) => [author.id.split("/").at(-1)!, topicNames(author.topics)]));
}

/** Names by ID. Our index answers an OpenAlex ID with its own record, so a name goes under both, for a saved filter that holds the OpenAlex ID. */
export async function readOpenAlexNames(entity: LookupEntity, ids: readonly string[], source: SearchSource = "openalex"): Promise<Record<string, string>> {
  const body = namesSchema.parse(
    await readOpenAlex(entity, { filter: `openalex_id:${ids.join("|")}`, select: source === "openscholar" ? "id,display_name,ids" : "id,display_name", "per-page": "100" }, source),
  );
  return Object.fromEntries(body.results.flatMap((record) => {
    const paired = record.ids?.openalex?.split("/").at(-1);
    return [...(paired ? [[paired, record.display_name]] : []), [record.id.split("/").at(-1)!, record.display_name]];
  }));
}

/** One author's whole record, by their ID. */
export async function readOpenAlexAuthor(id: string, source: SearchSource): Promise<unknown> {
  return readOpenAlex(`authors/${id}`, {}, source);
}
