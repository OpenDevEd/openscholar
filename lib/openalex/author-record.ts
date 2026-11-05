import { z } from "zod";
import { openAlexFetch } from "./fetch";
import { searchUrl } from "./request-url";
import { pairedRecords } from "./whole-person";

export const authorRecordSchema = z.object({
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

export const authorPageSchema = z.object({ meta: z.object({ count: z.number().nullish() }).nullish(), results: z.array(authorRecordSchema) });

/** Every record our index pairs with an OpenAlex author: the one person, split. */
export async function readPairedRecords(id: string, init: RequestInit = {}) {
  const response = await openAlexFetch(searchUrl("openscholar", "authors", { filter: `openalex:${id}`, "per-page": "200" }), { timeoutMs: 10_000, ...init } as RequestInit & { timeoutMs: number });
  if (!response.ok) throw new Error(`Author ${id} returned ${response.status}`);
  return pairedRecords(id, authorPageSchema.parse(await response.json()).results);
}
