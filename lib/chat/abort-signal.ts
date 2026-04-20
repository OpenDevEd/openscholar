/**
 * Sentinel strings that travel between the streaming action's AbortController
 * and the chat message query. generateResponse aborts with
 * `new DOMException(ABORT_REASON_USER_STOPPED, "AbortError")` — the library's
 * call.fail handler persists the MessageDoc as
 * `{ status: "failed", error: ABORT_ERROR_STRING }`. listThreadMessages
 * recognizes that exact string and surfaces an `aborted: true` flag instead of
 * leaking the sentinel to the client.
 */
export const ABORT_REASON_USER_STOPPED = "user_stopped";

/**
 * Matches `new DOMException(ABORT_REASON_USER_STOPPED, "AbortError").toString()`
 * — the exact string the agent library writes into MessageDoc.error via
 * `finalizeMessage` in its abort path.
 */
export const ABORT_ERROR_STRING = `AbortError: ${ABORT_REASON_USER_STOPPED}`;
