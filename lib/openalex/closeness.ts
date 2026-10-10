/**
 * Works ordered by closeness by meaning, as the OpenScholar API orders them (its own GET
 * /works/closeness): the works named, scored by how close each is to the papers rated as like
 * what is sought, less how close it is to those rated as not, the highest first. Every work the
 * API holds a vector for is scored, a paper with only a title too. Server side only: it reads the key.
 */
import { z } from "zod";
import { OPENALEX_TIMEOUT_MS, openAlexFetch, openAlexReason } from "./fetch";
import { openAlexUrl, worksAskOpenAlex } from "./request-url";

/** A work in the order, by its id in full, and its score; null when the API holds no vector for it. */
export type Closeness = { id: string; score: number | null };

/** The order, or why there is none, with the API's own message when it gave one. */
export type ClosenessResult = { ok: true; order: Closeness[] } | { ok: false; status: number | null; message: string };

const answerSchema = z.object({
  results: z.array(z.object({ id: z.string(), relevance_score: z.number().nullable() })),
});

const FAILED = { ok: false, status: null, message: "Ordering request failed" } as const;

/**
 * `works` ordered by closeness to `similarTo` and away from `dissimilarTo`, each a list of work ids,
 * as the API takes them: at most 200 works, and 100 of each kind of example, `similarTo` one at least.
 * OpenAlex has no such order, so without the OpenScholar API there is none.
 */
export async function fetchClosenessOrder(works: string[], similarTo: string[], dissimilarTo: string[]): Promise<ClosenessResult> {
  if (worksAskOpenAlex()) return { ok: false, status: null, message: "Ordering by closeness needs the OpenScholar API" };
  const url = openAlexUrl("works/closeness", {
    works: works.join("|"),
    similar_to: similarTo.join("|"),
    dissimilar_to: dissimilarTo.length > 0 ? dissimilarTo.join("|") : undefined,
  });
  let response: Response;
  try {
    response = await openAlexFetch(url, { timeoutMs: OPENALEX_TIMEOUT_MS });
  } catch (error) {
    console.error("Ordering request failed:", error);
    return FAILED;
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = openAlexReason(typeof body === "object" ? (body as { message?: unknown }) : null);
    return { ok: false, status: response.status, message: reason ?? `Ordering request failed (${response.status})` };
  }
  const answer = answerSchema.safeParse(body);
  if (!answer.success) return FAILED;
  return { ok: true, order: answer.data.results.map(({ id, relevance_score }) => ({ id, score: relevance_score })) };
}
