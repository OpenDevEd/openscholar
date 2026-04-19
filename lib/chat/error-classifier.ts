/**
 * Chat error classifier — shared between Convex runtime and the Next.js
 * client. Produces a structured envelope from any error shape we see
 * coming out of the AI SDK / OpenRouter so the UI can render a specific
 * class instead of a generic "Response failed".
 *
 * Error classes track the design spec produced by the redesign research:
 * rate_limit, insufficient_credits, model_unavailable, auth, moderation,
 * context_too_long, network, provider_5xx, aborted, unknown.
 */

export type ChatErrorClass =
  | "rate_limit"
  | "insufficient_credits"
  | "model_unavailable"
  | "auth"
  | "moderation"
  | "context_too_long"
  | "network"
  | "provider_5xx"
  | "aborted"
  | "unknown";

export type ChatErrorEnvelope = {
  version: 1;
  class: ChatErrorClass;
  httpStatus?: number;
  retryAfterMs?: number;
  providerName?: string;
  /**
   * Short human-readable fallback. Prefer i18n keyed on `class` in the UI;
   * use this only when you need to surface raw provider text.
   */
  message: string;
};

/** Envelopes that aren't recoverable by hitting "retry" with the same model. */
const REQUIRES_EDIT: ReadonlySet<ChatErrorClass> = new Set([
  "moderation",
  "context_too_long",
]);
const REQUIRES_ATTENTION: ReadonlySet<ChatErrorClass> = new Set([
  "insufficient_credits",
  "auth",
]);

export function isRetryable(envelope: ChatErrorEnvelope): boolean {
  return (
    !REQUIRES_EDIT.has(envelope.class) &&
    !REQUIRES_ATTENTION.has(envelope.class) &&
    envelope.class !== "aborted"
  );
}

export function requiresUserEdit(envelope: ChatErrorEnvelope): boolean {
  return REQUIRES_EDIT.has(envelope.class);
}

export function requiresAdminAction(envelope: ChatErrorEnvelope): boolean {
  return REQUIRES_ATTENTION.has(envelope.class);
}

const ENVELOPE_PREFIX = "__chat_err_v1__:";

/** Serialize as a prefixed JSON string so `message.error` can hold it. */
export function serializeChatError(envelope: ChatErrorEnvelope): string {
  return `${ENVELOPE_PREFIX}${JSON.stringify(envelope)}`;
}

/**
 * Parse a raw `message.error` string. Returns a normalized envelope —
 * legacy plain-string errors are mapped to class "unknown" with the raw
 * text as `message`, so the UI always has something to show.
 */
export function parseChatError(
  raw: string | undefined | null,
): ChatErrorEnvelope | null {
  if (!raw) return null;
  if (raw.startsWith(ENVELOPE_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(ENVELOPE_PREFIX.length));
      if (isEnvelope(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  return { version: 1, class: "unknown", message: raw };
}

function isEnvelope(value: unknown): value is ChatErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.class === "string" && typeof v.message === "string";
}

export function classifyChatError(error: unknown): ChatErrorEnvelope {
  const rec = toRecord(error);
  const httpStatus = extractStatus(rec);
  const providerName = extractProviderName(rec);
  const message = extractMessage(rec) ?? "Unknown error";
  const retryAfterMs = extractRetryAfterMs(rec);

  // Detect user-initiated aborts first — they come through as DOMException
  // or AbortError, not AI SDK APICallError.
  if (isAbort(rec)) {
    return envelope("aborted", message, { providerName });
  }

  // Explicit credit guard we throw in generateResponse pre-flight.
  if (rec.code === "AI_INSUFFICIENT_CREDITS" || /insufficient credits/i.test(message)) {
    return envelope("insufficient_credits", message, { httpStatus, providerName });
  }

  if (typeof httpStatus === "number") {
    if (httpStatus === 429) {
      return envelope("rate_limit", message, { httpStatus, providerName, retryAfterMs });
    }
    if (httpStatus === 401 || httpStatus === 403) {
      // OpenRouter / providers return 403 for moderation with a flagged
      // reason; otherwise treat 401/403 as auth.
      if (isModerationError(rec)) {
        return envelope("moderation", message, { httpStatus, providerName });
      }
      return envelope("auth", message, { httpStatus, providerName });
    }
    if (httpStatus === 402) {
      return envelope("insufficient_credits", message, { httpStatus, providerName });
    }
    if (httpStatus === 400 && isContextTooLong(message)) {
      return envelope("context_too_long", message, { httpStatus, providerName });
    }
    if (httpStatus === 400) {
      // Some providers return 400 for moderation/policy.
      if (isModerationError(rec)) {
        return envelope("moderation", message, { httpStatus, providerName });
      }
      // Otherwise group with provider error — generally not retryable without edit,
      // but we don't know for sure, so treat as unknown to let the user try.
      return envelope("unknown", message, { httpStatus, providerName });
    }
    if (httpStatus === 404 || httpStatus === 502 || httpStatus === 503) {
      return envelope("model_unavailable", message, { httpStatus, providerName });
    }
    if (httpStatus === 408) {
      return envelope("network", message, { httpStatus, providerName });
    }
    if (httpStatus >= 500) {
      return envelope("provider_5xx", message, { httpStatus, providerName });
    }
  }

  // Network / fetch failures — no statusCode available.
  if (isNetworkError(rec)) {
    return envelope("network", message, { providerName });
  }

  // Stringified upstream failures reach us when the agent's own error
  // pipeline swallows the structured APICallError (see `call.fail` →
  // `finalizeMessage` re-processing stream chunks and throwing). All we
  // have left is a terse "Provider returned error" — map it to a
  // generic upstream class so the UI shows *something* useful instead
  // of bare "Something went wrong".
  if (/provider returned error/i.test(message)) {
    return envelope("provider_5xx", message, { providerName });
  }

  return envelope("unknown", message, { providerName });
}

/* ─────────────────────── helpers ─────────────────────── */

function envelope(
  cls: ChatErrorClass,
  message: string,
  extras: {
    httpStatus?: number;
    retryAfterMs?: number;
    providerName?: string;
  } = {},
): ChatErrorEnvelope {
  const { httpStatus, retryAfterMs, providerName } = extras;
  return {
    version: 1,
    class: cls,
    message: truncate(message, 500),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(providerName ? { providerName } : {}),
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function toRecord(err: unknown): Record<string, unknown> {
  if (err && typeof err === "object") return err as Record<string, unknown>;
  return { message: typeof err === "string" ? err : String(err) };
}

function extractStatus(rec: Record<string, unknown>): number | undefined {
  // AI SDK APICallError: `statusCode`. Plain fetch Response: `status`.
  const s = rec.statusCode ?? rec.status;
  if (typeof s === "number" && Number.isInteger(s) && s >= 100 && s < 600) return s;
  // OpenRouter nests: { error: { code: 429 } } — serialized at the `body` level.
  const body = parseJsonIfString(rec.body ?? rec.data$);
  const nested = body?.error;
  if (nested && typeof nested === "object") {
    const code = (nested as Record<string, unknown>).code;
    if (typeof code === "number" && code >= 100 && code < 600) return code;
  }
  return undefined;
}

function extractProviderName(rec: Record<string, unknown>): string | undefined {
  const body = parseJsonIfString(rec.body ?? rec.data$);
  const nested = body?.error as Record<string, unknown> | undefined;
  const md = nested?.metadata as Record<string, unknown> | undefined;
  const name = md?.provider_name ?? md?.providerName;
  if (typeof name === "string" && name.length > 0) return name;
  return undefined;
}

function extractMessage(rec: Record<string, unknown>): string | undefined {
  // Prefer nested provider-level `raw` (OpenRouter) — it's the most useful
  // for the user ("gemma-4-26b:free is temporarily rate-limited upstream").
  const body = parseJsonIfString(rec.body ?? rec.data$);
  const nested = body?.error as Record<string, unknown> | undefined;
  const md = nested?.metadata as Record<string, unknown> | undefined;
  const raw = md?.raw;
  if (typeof raw === "string" && raw.length > 0) return raw;
  const nestedMsg = nested?.message;
  if (typeof nestedMsg === "string" && nestedMsg.length > 0) return nestedMsg;
  const topMsg = rec.message;
  if (typeof topMsg === "string" && topMsg.length > 0) return topMsg;
  return undefined;
}

function extractRetryAfterMs(rec: Record<string, unknown>): number | undefined {
  const headers = rec.responseHeaders ?? rec.headers;
  if (!headers || typeof headers !== "object") return undefined;
  const headerLike = headers as Record<string, unknown>;
  // May be a plain object, or a Headers instance.
  const rawValue =
    typeof (headerLike.get as unknown) === "function"
      ? (headerLike as { get(k: string): string | null }).get("retry-after")
      : (headerLike["retry-after"] ?? headerLike["Retry-After"]);
  if (typeof rawValue !== "string") return undefined;
  const seconds = Number.parseInt(rawValue, 10);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600) {
    return seconds * 1000;
  }
  return undefined;
}

function parseJsonIfString(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isAbort(rec: Record<string, unknown>): boolean {
  const name = typeof rec.name === "string" ? rec.name : "";
  if (name === "AbortError") return true;
  const msg = typeof rec.message === "string" ? rec.message.toLowerCase() : "";
  return msg.includes("aborted") || msg.includes("abortsignal");
}

function isNetworkError(rec: Record<string, unknown>): boolean {
  const name = typeof rec.name === "string" ? rec.name : "";
  if (name === "FetchError" || name === "TypeError") return true;
  const msg = typeof rec.message === "string" ? rec.message.toLowerCase() : "";
  return (
    msg.includes("fetch failed") ||
    msg.includes("network request failed") ||
    msg.includes("socket hang up") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}

function isModerationError(rec: Record<string, unknown>): boolean {
  const body = parseJsonIfString(rec.body ?? rec.data$);
  const nested = body?.error as Record<string, unknown> | undefined;
  const md = nested?.metadata as Record<string, unknown> | undefined;
  if (md && typeof md === "object") {
    if (md.reasons !== undefined || md.flagged_input !== undefined) return true;
    if (typeof md.raw === "string" && /moderat|flagg|policy/i.test(md.raw)) return true;
  }
  const msg = typeof rec.message === "string" ? rec.message : "";
  return /moderat|content policy|flagged/i.test(msg);
}

function isContextTooLong(message: string): boolean {
  return /context length|context_length|too long|maximum context|prompt is too long/i.test(
    message,
  );
}
