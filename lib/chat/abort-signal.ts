/**
 * Sentinel strings that travel between the streaming action's AbortController
 * and the chat message query. generateResponse aborts with
 * `new DOMException(ABORT_REASON_USER_STOPPED, "AbortError")`; the library's
 * call.fail handler persists the MessageDoc as
 * `{ status: "failed", error: ABORT_ERROR_STRING }`. A late stream save can
 * also wrap that sentinel in the agent's "Trying to update a message that
 * failed" text. listThreadMessages recognizes both current wire strings and
 * surfaces an `aborted: true` flag instead of leaking them to the client.
 */
export const ABORT_REASON_USER_STOPPED = "user_stopped";

/**
 * @convex-dev/agent persists aborts from `start()` via
 * `abortSignal.reason?.toString()` (node_modules/@convex-dev/agent/src/client/
 * start.ts:170-176). DOMException#toString includes the name and message, so
 * the runtime wire value is `"AbortError: user_stopped"`.
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
 *      This is the shape extraction's onComplete handler hands to
 *      classifyUnknownError when it rehydrates a stored error string.
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
