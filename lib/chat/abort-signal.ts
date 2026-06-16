/**
 * Bare reason fragment used by the strict abort detector in
 * lib/errors/taxonomy.ts to recognise the in-memory DOMException shape
 * `{ name: "AbortError", message: "user_stopped" }`. NOT used as the
 * runtime abort reason itself anymore — generateResponse passes the
 * full ABORT_ERROR_STRING below directly to abortController.abort.
 */
export const ABORT_REASON_USER_STOPPED = "user_stopped";

/**
 * Wire string for user-initiated aborts. generateResponse calls
 * `abortController.abort(ABORT_ERROR_STRING)` so this string IS the
 * abort reason — `signal.reason` is the literal string itself, not a
 * DOMException. The agent library serializes via
 * `abortSignal.reason?.toString()` (node_modules/@convex-dev/agent/src/
 * client/start.ts:170-176); String#toString returns the string itself,
 * so MessageDoc.error gets ABORT_ERROR_STRING verbatim. Our defensive
 * persistAssistantAbortSentinel writes the same value, so the two
 * paths are trivially equal — no longer dependent on the runtime
 * format of `new DOMException(reason, name).toString()`.
 *
 * A late stream save can also wrap this sentinel in the agent's
 * "Trying to update a message that failed: …" text; isAbortErrorString
 * recognises both shapes.
 */
export const ABORT_ERROR_STRING = `AbortError: ${ABORT_REASON_USER_STOPPED}`;

const ABORT_UPDATE_FAILED_PREFIX = "Trying to update a message that failed: ";
const ABORT_UPDATE_FAILED_SUFFIX = `, error: ${ABORT_ERROR_STRING}`;

export function isAbortErrorString(error: string): boolean {
  return (
    error === ABORT_ERROR_STRING ||
    (error.startsWith(ABORT_UPDATE_FAILED_PREFIX) &&
      error.endsWith(ABORT_UPDATE_FAILED_SUFFIX))
  );
}

/**
 * Single decision rule for "this value represents a user-initiated abort".
 * Accepts the three shapes our pipeline observes:
 *
 *   1. In-memory DOMException — `{ name: "AbortError", message: <anything> }`.
 *      Matches AI SDK's AbortError instances and the agent's pre-serialized
 *      DOMException. Permissive on message to keep parity with the existing
 *      classifyUnknownError R7 contract.
 *   2. `new Error(persistedSentinel)` — name "Error", message
 *      "AbortError: user_stopped" (or the agent's "Trying to update a
 *      message that failed: …, error: AbortError: user_stopped" wrapper).
 *      This is the shape callers get when they rehydrate a stored error
 *      string before classification.
 *   3. Plain Record `{ name?, message? }` or the bare sentinel string —
 *      lets callers pass parsed-JSON envelopes or raw payload strings
 *      without first wrapping in Error.
 */
export function isAbortLike(input: unknown): boolean {
  if (input == null) return false;
  let name = "";
  let message = "";
  if (input instanceof Error) {
    name = input.name;
    message = input.message;
  } else if (typeof input === "object") {
    const rec = input as Record<string, unknown>;
    if (typeof rec.name === "string") name = rec.name;
    if (typeof rec.message === "string") message = rec.message;
  } else if (typeof input === "string") {
    message = input;
  } else {
    return false;
  }
  if (name === "AbortError") return true;
  return isAbortErrorString(message);
}
