/** The time a works request may take in all, shared by the search, its count and OQL. */

/**
 * How long a works request may take in all, its tries, waits and reading included: well past
 * the OpenScholar API's own 30 s for a request, where the SDK had no limit.
 */
export const WORKS_TIME_LIMIT_MS = 60_000;

/** Runs `ask` with a signal that aborts once the time limit passes; its timer is cleared however it ends. */
export async function withinTimeLimit<T>(ask: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), WORKS_TIME_LIMIT_MS);
  try {
    return await ask(deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}
