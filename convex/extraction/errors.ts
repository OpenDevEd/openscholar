/**
 * Error classification for the extraction pipeline.
 *
 * Pure function module -- no Convex imports, no "use node" directive.
 * Classifies errors as retryable (workpool retries up to maxAttempts: 3)
 * or permanent (return {success: false}, no retry).
 *
 * Consumed by workpoolActions.ts to decide retry vs fail behavior.
 * See: D-06, D-07 in 93-CONTEXT.md
 */

export type ErrorCategory =
  | "network"
  | "rate_limit"
  | "timeout"
  | "server_error"
  | "validation"
  | "not_found"
  | "bad_request"
  | "parse_failure"
  | "empty_body"
  | "page_limit";

export type ClassifiedError = {
  retryable: boolean;
  category: ErrorCategory;
  message: string;
};

/**
 * Classify an extraction error as retryable or permanent.
 *
 * Classification rules are checked in priority order:
 * 1. DOMException (AbortError/TimeoutError) -> retryable timeout
 * 2. TypeError with "fetch" -> retryable network
 * 3. "429" or "rate limit" -> retryable rate_limit
 * 4. 5xx status codes -> retryable server_error
 * 5. "404" or "not found" -> permanent not_found
 * 6. "400" or "bad request" -> permanent bad_request
 * 7. "ZodError" or "validation" -> permanent validation
 * 8. "empty body" or "no body text" -> permanent empty_body
 * 9. "page" AND "exceeded" -> permanent page_limit
 * 10. Default fallback -> retryable network (safe: maxAttempts: 3 caps wasted retries)
 */
export function classifyExtractionError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);

  // 1. AbortSignal timeout (DOMException)
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return { retryable: true, category: "timeout", message };
  }

  // 2. Network errors (fetch failures)
  if (error instanceof TypeError && message.includes("fetch")) {
    return { retryable: true, category: "network", message };
  }

  // 3. Rate limiting (429 or "rate limit")
  if (/429|rate limit/i.test(message)) {
    return { retryable: true, category: "rate_limit", message };
  }

  // 4. Server errors (5xx status codes)
  if (/\b5\d{2}\b/.test(message)) {
    return { retryable: true, category: "server_error", message };
  }

  // 5. Not found (404)
  if (/404|not found/i.test(message)) {
    return { retryable: false, category: "not_found", message };
  }

  // 6. Bad request (400)
  if (/400|bad request/i.test(message)) {
    return { retryable: false, category: "bad_request", message };
  }

  // 7. Validation failures (Zod or generic)
  if (/ZodError|validation/i.test(message)) {
    return { retryable: false, category: "validation", message };
  }

  // 8. Empty body text
  if (/empty body|no body text/i.test(message)) {
    return { retryable: false, category: "empty_body", message };
  }

  // 9. Page count exceeded
  if (/page/i.test(message) && /exceeded/i.test(message)) {
    return { retryable: false, category: "page_limit", message };
  }

  // 10. Default: assume retryable (network-like failure)
  // Safe default -- workpool maxAttempts: 3 caps wasted retries
  return { retryable: true, category: "network", message };
}
