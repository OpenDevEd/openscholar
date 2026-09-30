import { z } from "zod";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters, Work } from "@sickrin/openalex-sdk/dist/src/types/work";
import { worksUrl } from "./works-url";

const goals = z.array(z.object({id: z.string(), display_name: z.string(), score: z.number()})).optional();
const responseSchema = z.object({
  meta: z.object({count: z.number().int().nonnegative(), next_cursor: z.string().nullable()}),
  results: z.array(z.looseObject({
    id: z.string(),
    abstract_inverted_index: z.record(z.string(), z.array(z.number().int().nonnegative())).nullable().optional(),
  })),
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
    results: parsed.results.map(({abstract_inverted_index, sustainable_development_goals, ...fields}) => {
      const work: Work = {...fields, ...(abstract_inverted_index ? {abstract: convertAbstractArrayToString(abstract_inverted_index)} : {})};
      return {...work, sustainable_development_goals: goals.parse(sustainable_development_goals)};
    }),
  };
}
