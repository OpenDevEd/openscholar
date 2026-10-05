import "server-only";
import { z } from "zod";
import { openAlexUrl } from "./request-url";
import { autocompleteOptions, autocompleteParameters, sourceTypesParameters, withSourceTypes, type LookupEntity, type LookupOption } from "./autocomplete";

const namesSchema = z.object({
  results: z.array(z.object({ id: z.string(), display_name: z.string() })),
});
const topicsSchema = z.object({
  results: z.array(z.object({ id: z.string(), topics: z.array(z.object({ display_name: z.string() })).nullish() })),
});

/** An author's three main research topics, comma separated, as OpenAlex lists them. */
export const topicNames = (topics?: readonly { display_name: string }[] | null) =>
  topics?.slice(0, 3).map((topic) => topic.display_name).join(", ") ?? "";

async function readOpenAlex(path: string, parameters: Record<string, string>): Promise<unknown> {
  const response = await fetch(openAlexUrl(path, parameters), { signal: AbortSignal.timeout(12000), next: { revalidate: 3600 } });
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
export async function searchOpenAlex(entity: LookupEntity, query: string): Promise<LookupOption[]> {
  const options = autocompleteOptions(await readOpenAlex(`autocomplete/${entity}`, autocompleteParameters(query)));
  if (entity !== "sources" || !options.length) return options;
  return withSourceTypes(options, await readOpenAlex("sources", sourceTypesParameters(options.map((option) => option.id))));
}

/** Each author's main topics, which autocomplete leaves out. One request. */
export async function readOpenAlexAuthorTopics(ids: readonly string[]): Promise<Record<string, string>> {
  const body = topicsSchema.parse(await readOpenAlex("authors", { filter: `openalex_id:${ids.join("|")}`, select: "id,topics", "per-page": "100" }));
  return Object.fromEntries(body.results.map((author) => [author.id.split("/").at(-1)!, topicNames(author.topics)]));
}

export async function readOpenAlexNames(entity: LookupEntity, ids: readonly string[]): Promise<Record<string, string>> {
  const body = namesSchema.parse(
    await readOpenAlex(entity, { filter: `openalex_id:${ids.join("|")}`, select: "id,display_name", "per-page": "100" }),
  );
  return Object.fromEntries(body.results.map((record) => [record.id.split("/").at(-1)!, record.display_name]));
}
