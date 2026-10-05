/** How long a search or a count may take before it fails, as the results page's reads do. */
export const OPENALEX_TIMEOUT_MS = 12_000;
/** Times a request OpenAlex throttles is made in all. */
const TRIES = 4;
/** The longest wait OpenAlex can ask for that is still waited out. A longer one is the day's budget, which no retry outlasts. */
const RETRY_WAIT_MAX_S = 5;
/** Spread added to the wait, so requests refused together don't come back together. */
const RETRY_SPREAD_MS = 300;

/**
 * A request to OpenAlex, made again when OpenAlex throttles it. A search with more than 5
 * boolean operators is refused (429) when it arrives within about 0.04 s of another such
 * search on OpenScholar's key, whoever sent that one, so spacing one's own requests doesn't
 * prevent it. OpenAlex says how long to wait: 1 s for that limit. Measured on 2026-10-05,
 * five pages of a 19-operator search all refused at once came back within three tries each.
 * Each try gets its own `timeoutMs`.
 */
export async function openAlexFetch(url: URL | string, { timeoutMs, ...init }: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  for (let tries = 1; ; tries += 1) {
    const response = await fetch(url, { ...init, ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
    const wait = Number(response.headers.get("retry-after"));
    if (response.status !== 429 || tries === TRIES || !(wait <= RETRY_WAIT_MAX_S)) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, wait * 1000 + Math.random() * RETRY_SPREAD_MS));
  }
}

/** OpenAlex's own words for refusing a request. An OQL search's are in its validation errors. */
export function openAlexReason(body: { validation?: { errors?: Array<{ message?: unknown }> }; message?: unknown } | null): string | undefined {
  const reason = body?.validation?.errors?.[0]?.message ?? body?.message;
  return typeof reason === "string" && reason ? reason : undefined;
}
