import { z } from "zod";
import { abstractFromIndex } from "@/lib/papers/abstract-text";
import type { SearchParameters, Work, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import type { SearchSource } from "../search/source";
import { OPENALEX_TIMEOUT_MS, openAlexFetch, openAlexReason } from "./fetch";
import { openAlexUrl } from "./request-url";
import { SearchError } from "../search/search-error";
import { appWork } from "./work-id";
import { worksUrl } from "./works-url";

const goals = z.array(z.object({id: z.string(), display_name: z.string(), score: z.number()})).optional();
const workSchema = z.looseObject({
  id: z.string(),
  abstract_inverted_index: z.record(z.string(), z.array(z.number().int().nonnegative())).nullable().optional(),
});
const responseSchema = z.object({
  meta: z.object({count: z.number().int().nonnegative(), next_cursor: z.string().nullable()}),
  results: z.array(workSchema),
});

/** A provider's work as the app holds one: its abstract as text, and its ID as the app names it. */
function heldWork({abstract_inverted_index, sustainable_development_goals, ...fields}: z.infer<typeof workSchema>) {
  const work: Work = appWork({...fields, ...(abstract_inverted_index ? {abstract: abstractFromIndex(abstract_inverted_index)} : {})});
  return {...work, sustainable_development_goals: goals.parse(sustainable_development_goals)};
}

/**
 * One provider page per request. The SDK's numbered pages replay all earlier cursors.
 * Server side only: it reads the source's key.
 */
export async function readOpenAlexWorks(parameters: SearchParameters & {cursor: string}, source: SearchSource = "openalex") {
  const url = worksUrl(parameters, { cursor: parameters.cursor, "per-page": String(parameters.perPage ?? 10) }, source);
  const response = await openAlexFetch(url, {timeoutMs: OPENALEX_TIMEOUT_MS, next: {revalidate: 60}} as RequestInit & {timeoutMs: number});
  if (!response.ok) throw new SearchError(`Publications unavailable: ${response.status}`, response.status);
  const parsed = responseSchema.parse(await response.json());
  return {meta: parsed.meta, results: parsed.results.map(heldWork)};
}

/**
 * One work as OpenAlex holds it, by its OpenAlex ID, or null when OpenAlex has none. Asked for as a record, which
 * OpenAlex charges nothing for: the same work asked for as a list of one costs a credit of the day's 2,000,000, and
 * every paper page asks (2.2 million a day while browsers crawled them on 18 November 2026).
 */
export async function readOpenAlexWork(id: string) {
  const response = await openAlexFetch(openAlexUrl(`works/${id}`), {timeoutMs: OPENALEX_TIMEOUT_MS, next: {revalidate: 60}} as RequestInit & {timeoutMs: number});
  if (response.status === 404) return null;
  if (!response.ok) throw new SearchError(`Publication unavailable: ${response.status}`, response.status);
  return heldWork(workSchema.parse(await response.json()));
}

/** A page of works from our index, or why there is none, in its own words. */
export type OwnWorksResult = { ok: true; data: Works } | { ok: false; status: number | null; message: string };

/**
 * A page of works from our index, shaped as the SDK shapes OpenAlex's, with the abstract as text. A fetch, not the SDK,
 * which only speaks to OpenAlex and drops the reason a request was refused. `at` is a numbered page, or the first page of a list that goes on by cursor.
 */
export async function fetchOwnWorks(parameters: SearchParameters, at: { page: number; perPage: number } | { perPage: number }, extra: Record<string, string | undefined> = {}): Promise<OwnWorksResult> {
  let response: Response;
  try {
    // Inside the try: a request that can't be built, with our index's address unset, is answered like one that failed.
    const url = worksUrl(parameters, { "per-page": String(at.perPage), ...("page" in at ? { page: String(at.page) } : { cursor: "*" }), ...extra }, "openscholar");
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
        ...(abstract_inverted_index ? { abstract: abstractFromIndex(abstract_inverted_index) } : {}),
      })),
    } as Works,
  };
}
