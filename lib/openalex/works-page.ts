import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { SearchParameters, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import { withinTimeLimit } from "./time-limit";
import { worksPageSchema } from "./work-schema";
import { worksUrl } from "./works-url";

/** A works page, or why there is none, with the API's own message when it gave one. */
export type WorksPageResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string };

/** Answers the SDK asked again after, as this does: a rate limit or a passing server failure. */
const RETRIED_STATUSES = new Set([429, 500, 502, 503, 504]);
/** The SDK's tries, and the wait between them. */
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 1_000;

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
 * WORKS_TIME_LIMIT_MS in all. Server side only: it reads the key.
 */
export async function fetchWorksPage(parameters: SearchParameters & { perPage: number }): Promise<WorksPageResult> {
  return withinTimeLimit((signal) => readPage(worksUrl(parameters, { per_page: String(parameters.perPage), cursor: "*" }), signal));
}

/** The page at `url`, or why there is none, read before `signal` aborts. */
async function readPage(url: URL, signal: AbortSignal): Promise<WorksPageResult> {
  const response = await askWithRetries(url, signal);
  if (!response) return signal.aborted ? TIMED_OUT : FAILED;
  const body: unknown = await response.json().catch(() => null);
  if (body === null && signal.aborted) return TIMED_OUT;
  if (!response.ok) return { ok: false, status: response.status, message: reasonOf(body, response.status) };
  const page = worksPageSchema.safeParse(body);
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
