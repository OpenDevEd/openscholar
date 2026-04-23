/**
 * Sentinel strings that travel between the streaming action's AbortController
 * and the chat message query. generateResponse aborts with
 * `new DOMException(ABORT_REASON_USER_STOPPED, "AbortError")`; the library's
 * call.fail handler persists the MessageDoc as
 * `{ status: "failed", error: ABORT_ERROR_STRING }`. listThreadMessages
 * recognizes that exact string and surfaces an `aborted: true` flag instead of
 * leaking the sentinel to the client.
 */
export const ABORT_REASON_USER_STOPPED = "user_stopped";

/**
 * The agent library's `errorToString` normalizes Error instances via
 * `error.message` rather than `error.toString()` (node_modules/@convex-dev/
 * agent/src/client/utils.ts:22-26). For a `DOMException("user_stopped",
 * "AbortError")` that means the string persisted to `MessageDoc.error` is
 * the bare reason `"user_stopped"` — NOT `"AbortError: user_stopped"`.
 * Matching the bare reason is what lets listThreadMessages attach
 * `aborted: true` and the AbortedPill render on real runtime aborts.
 */
export const ABORT_ERROR_STRING = ABORT_REASON_USER_STOPPED;
