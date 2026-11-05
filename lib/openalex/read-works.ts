import { z } from "zod";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters, Work, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import type { SearchSource } from "../search/source";
import { OPENALEX_TIMEOUT_MS, openAlexFetch, openAlexReason } from "./fetch";
import { appWork } from "./work-id";
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
 * Server side only: it reads the source's key.
 */
export async function readOpenAlexWorks(parameters: SearchParameters & {cursor: string}, source: SearchSource = "openalex") {
  const url = worksUrl(parameters, { cursor: parameters.cursor, "per-page": String(parameters.perPage ?? 10) }, source);
  const response = await openAlexFetch(url, {timeoutMs: OPENALEX_TIMEOUT_MS, next: {revalidate: 60}} as RequestInit & {timeoutMs: number});
  if (!response.ok) throw new Error(`Publications unavailable: ${response.status}`);
  const parsed = responseSchema.parse(await response.json());
  return {
    meta: parsed.meta,
    results: parsed.results.map(({abstract_inverted_index, sustainable_development_goals, ...fields}) => {
      const work: Work = appWork({...fields, ...(abstract_inverted_index ? {abstract: convertAbstractArrayToString(abstract_inverted_index)} : {})});
      return {...work, sustainable_development_goals: goals.parse(sustainable_development_goals)};
    }),
  };
}

/** A page of works from our index, or why there is none, in its own words. */
export type OwnWorksResult = { ok: true; data: Works } | { ok: false; status: number | null; message: string };

/**
 * A page of works from our index, shaped as the SDK shapes OpenAlex's, with the abstract as text. A fetch, not the SDK,
 * which only speaks to OpenAlex and drops the reason a request was refused. `at` is a numbered page, or the first page of a list that goes on by cursor.
 */
export async function fetchOwnWorks(parameters: SearchParameters, at: { page: number; perPage: number } | { perPage: number }): Promise<OwnWorksResult> {
  let response: Response;
  try {
    // Inside the try: a request that can't be built, with our index's address unset, is answered like one that failed.
    const url = worksUrl(parameters, { "per-page": String(at.perPage), ...("page" in at ? { page: String(at.page) } : { cursor: "*" }) }, "openscholar");
    response = await openAlexFetch(url, { timeoutMs: OPENALEX_TIMEOUT_MS });
  } catch (error) {
    console.error("[search] our index didn't answer", error);
    return { ok: false, status: null, message: "Search request failed" };
  }
  const body = (await response.json().catch(() => null)) as (Works & { message?: unknown; error?: unknown }) | null;
  if (!response.ok || !body) {
    console.error("[search] our index refused a search", response.status, JSON.stringify(body)?.slice(0, 500));
    const said = openAlexReason(body) ?? (typeof body?.error === "string" ? body.error : undefined);
    return { ok: false, status: response.status, message: said ?? `Search request failed (${response.status})` };
  }
  return {
    ok: true,
    data: {
      meta: body.meta,
      results: (body.results ?? []).map(({ abstract_inverted_index, ...work }: Work) => appWork({
        ...work,
        ...(abstract_inverted_index ? { abstract: convertAbstractArrayToString(abstract_inverted_index) } : {}),
      })),
    } as Works,
  };
}
