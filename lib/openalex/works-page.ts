import { z } from "zod";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import { worksUrl } from "./works-url";

/** A works page, or why there is none, with the API's own message when it gave one. */
export type WorksPageResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string };

/** A field a work may lack, or hold as null, as OpenAlex and the OpenScholar API allow. */
const maybe = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const named = z.looseObject({ display_name: maybe(z.string()) });

/**
 * A work, as far as the search page reads into it: its id, its abstract's index, and the
 * fields the paper card shows as text or numbers, loops over or reads into. Any of these but
 * the id may be missing or null; one of another shape would break the card, so it fails the page.
 */
const workSchema = z.looseObject({
  id: z.string(),
  abstract_inverted_index: maybe(z.record(z.string(), z.array(z.number().int().nonnegative()))),
  display_name: maybe(z.string()),
  title: maybe(z.string()),
  doi: maybe(z.string()),
  type: maybe(z.string()),
  publication_year: maybe(z.number()),
  cited_by_count: maybe(z.number()),
  // The card reads each author's name without a guard; OpenAlex always sends the author.
  authorships: maybe(z.array(z.looseObject({ author: z.looseObject({ display_name: z.string() }) }))),
  primary_location: maybe(z.looseObject({ source: maybe(named) })),
  open_access: maybe(z.looseObject({ is_oa: maybe(z.boolean()), oa_url: maybe(z.string()) })),
  primary_topic: maybe(z.looseObject({ field: maybe(named), subfield: maybe(named), domain: maybe(named) })),
  related_works: maybe(z.array(z.string())),
  referenced_works: maybe(z.array(z.string())),
  sustainable_development_goals: maybe(z.array(z.looseObject({}))),
  biblio: maybe(z.looseObject({})),
});

/** What a page must hold to be read: its count, and works the search page can show. */
const pageSchema = z.object({
  meta: z.looseObject({ count: z.number().int().nonnegative() }),
  results: z.array(workSchema),
});

/** Answers the SDK asked again after, as this does: a rate limit or a passing server failure. */
const RETRIED_STATUSES = new Set([429, 500, 502, 503, 504]);
/** The SDK's tries, and the wait between them. */
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 1_000;
/**
 * How long a page may take in all, its tries, waits and reading included: well past the
 * OpenScholar API's own 30 s for a request, where the SDK had no limit.
 */
const TOTAL_BUDGET_MS = 60_000;

const FAILED = { ok: false, status: null, message: "Search request failed" } as const;
const TIMED_OUT = { ok: false, status: null, message: "Search request timed out" } as const;

/** Waits `ms`, unless `signal` aborts first; whether the whole wait passed. */
function waitFor(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The answer to `url`, asked again after a passing failure as the SDK asked; null when unreachable or out of time. */
async function askWithRetries(url: URL, signal: AbortSignal): Promise<Response | null> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (!signal.aborted) console.error("Works request failed:", error);
      return null;
    }
    if (!RETRIED_STATUSES.has(response.status) || attempt === ATTEMPTS) return response;
    await response.body?.cancel().catch(() => {});
    if (!(await waitFor(RETRY_DELAY_MS, signal))) return null;
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
 * against the caller's allowance, as the SDK's were not; unlike it, it gives up after
 * TOTAL_BUDGET_MS in all. Server side only: it reads the key.
 */
export async function fetchWorksPage(parameters: SearchParameters & { perPage: number }): Promise<WorksPageResult> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TOTAL_BUDGET_MS);
  try {
    return await readPage(worksUrl(parameters, { per_page: String(parameters.perPage), cursor: "*" }), deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** The page at `url`, or why there is none, read before `signal` aborts. */
async function readPage(url: URL, signal: AbortSignal): Promise<WorksPageResult> {
  const response = await askWithRetries(url, signal);
  if (!response) return signal.aborted ? TIMED_OUT : FAILED;
  const body: unknown = await response.json().catch(() => null);
  if (body === null && signal.aborted) return TIMED_OUT;
  if (!response.ok) return { ok: false, status: response.status, message: reasonOf(body, response.status) };
  const page = pageSchema.safeParse(body);
  if (!page.success) {
    console.error("A works answer is not a page of works:", page.error.issues.slice(0, 3));
    return FAILED;
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
