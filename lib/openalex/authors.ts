import "server-only";
import { z } from "zod";
import { bareId, readOpenAlex, type FunderOption } from "./funders";

const autocompleteSchema = z.object({
  results: z.array(z.object({ id: z.string(), display_name: z.string(), hint: z.string().nullable().optional() })),
});
const authorsSchema = z.object({
  results: z.array(z.object({ id: z.string(), display_name: z.string() })),
});

/** Authors whose names start with the words typed, as OpenAlex's autocomplete finds them, with where they work. */
export async function searchOpenAlexAuthors(query: string): Promise<FunderOption[]> {
  const body = autocompleteSchema.parse(await readOpenAlex("autocomplete/authors", { q: query }));
  return body.results.map((author) => ({
    id: bareId(author.id),
    name: author.display_name,
    ...(author.hint ? { detail: author.hint } : {}),
  }));
}

export async function readOpenAlexAuthorNames(ids: readonly string[]): Promise<Record<string, string>> {
  const body = authorsSchema.parse(
    await readOpenAlex("authors", { filter: `openalex_id:${ids.join("|")}`, select: "id,display_name", "per-page": "100" }),
  );
  return Object.fromEntries(body.results.map((author) => [bareId(author.id), author.display_name]));
}
