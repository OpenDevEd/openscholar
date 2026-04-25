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
