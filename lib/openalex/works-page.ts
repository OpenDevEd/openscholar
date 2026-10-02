import { z } from "zod";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import { worksUrl } from "./works-url";

/** A works page, or why there is none, with the API's own message when it gave one. */
export type WorksPageResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string };

/** What a page must hold to be read: its count, and works with an id and any abstract's index. */
const pageSchema = z.object({
  meta: z.looseObject({ count: z.number().int().nonnegative() }),
  results: z.array(z.looseObject({
    id: z.string(),
    abstract_inverted_index: z.record(z.string(), z.array(z.number().int().nonnegative())).nullable().optional(),
  })),
});

/** Answers the SDK asked again after, as this does: a rate limit or a passing server failure. */
const RETRIED_STATUSES = new Set([429, 500, 502, 503, 504]);
/** The SDK's tries, and the wait between them. */
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 1_000;

/** The answer to `url`, asked again after a passing failure as the SDK asked; null when unreachable. */
async function askWithRetries(url: URL): Promise<Response | null> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      console.error("Works request failed:", error);
      return null;
    }
    if (!RETRIED_STATUSES.has(response.status) || attempt === ATTEMPTS) return response;
    await response.body?.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

/** A refusal's own reason: its `message`, else its `error`, else its status. */
function reasonOf(body: unknown, status: number) {
  const reason = typeof body === "object" && body !== null ? (body as { message?: unknown; error?: unknown }) : {};
  if (typeof reason.message === "string" && reason.message) return reason.message;
  if (typeof reason.error === "string" && reason.error) return reason.error;
  return `Search request failed (${status})`;
}

/**
 * The first page of a works search, with each abstract as text, as the SDK answered it.
 * Asked with fetch rather than the SDK, which keeps one key for every host it is given and
 * drops the body of a failure, the message the search page shows. Like the SDK, it asks
 * again after a rate limit or a passing server failure, and those tries are not counted
 * against the caller's allowance, as the SDK's were not. Server side only: it reads the key.
 */
export async function fetchWorksPage(parameters: SearchParameters & { perPage: number }): Promise<WorksPageResult> {
  const response = await askWithRetries(worksUrl(parameters, { per_page: String(parameters.perPage), cursor: "*" }));
  if (!response) return { ok: false, status: null, message: "Search request failed" };
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status, message: reasonOf(body, response.status) };
  const page = pageSchema.safeParse(body);
  if (!page.success) {
    console.error("A works answer is not a page of works:", page.error.issues.slice(0, 3));
    return { ok: false, status: null, message: "Search request failed" };
  }
  return {
    ok: true,
    data: {
      meta: page.data.meta,
      results: page.data.results.map(({ abstract_inverted_index, ...work }) => ({
        ...work,
        ...(abstract_inverted_index ? { abstract: convertAbstractArrayToString(abstract_inverted_index) } : {}),
      })),
    } as unknown as Works,
  };
}
