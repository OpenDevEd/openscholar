import { z } from "zod";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters } from "@sickrin/openalex-sdk/dist/src/types/work";
import type { PaperResult } from "@/lib/types/search.types";
import { workSchema } from "./work-schema";
import { worksUrl } from "./works-url";

/** A cursor page of works, each checked as the search checks its own, SDG scores included. */
const responseSchema = z.object({
  meta: z.object({count: z.number().int().nonnegative(), next_cursor: z.string().nullable()}),
  results: z.array(workSchema),
});

/**
 * One provider page per request. The SDK's numbered pages replay all earlier cursors.
 * Server side only: it reads the OpenAlex key.
 */
export async function readOpenAlexWorks(parameters: SearchParameters & {cursor: string}) {
  const url = worksUrl(parameters, { cursor: parameters.cursor, "per-page": String(parameters.perPage ?? 10) });
  const response = await fetch(url, {signal: AbortSignal.timeout(12000), next: {revalidate: 60}});
  if (!response.ok) throw new Error(`OpenAlex publications unavailable: ${response.status}`);
  const parsed = responseSchema.parse(await response.json());
  return {
    meta: parsed.meta,
    results: parsed.results.map(({abstract_inverted_index, ...fields}) =>
      ({...fields, ...(abstract_inverted_index ? {abstract: convertAbstractArrayToString(abstract_inverted_index)} : {})}) as unknown as PaperResult),
  };
}
