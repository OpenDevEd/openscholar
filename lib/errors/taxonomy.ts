/**
 * Unified error taxonomy — shared between Convex runtime and the Next.js
 * client. Produces a structured envelope from any error shape we see
 * coming out of the AI SDK / OpenRouter / extraction pipeline so the UI
 * can render a specific code instead of a generic "Something went wrong".
 */

import { ConvexError, v } from "convex/values";

export const ERROR_CODES = [
  // chat + extraction shared
  "insufficient_credits",
  "rate_limit",
  "model_unavailable",
  "auth",
  "moderation",
  "context_too_long",
  "network",
  "provider_5xx",
  "aborted",
  "unknown",
  // extraction-only
  "action_timeout",
  "pdf_download_failed",
  "pdf_invalid",
  "paper_not_found",
  "indexing_failed",
  "llm_content_refusal",
  "schema_validation",
  "cancelled",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Convex validator for taxonomy codes — used in schema definitions for
 * the structured `error.code` field on extractionJobs / extractionPapers
 * / extractionPaperErrors.
 */
export const errorCodeValidator = v.union(
  v.literal("insufficient_credits"),
  v.literal("rate_limit"),
  v.literal("model_unavailable"),
  v.literal("auth"),
  v.literal("moderation"),
  v.literal("context_too_long"),
  v.literal("network"),
  v.literal("provider_5xx"),
  v.literal("aborted"),
  v.literal("unknown"),
  v.literal("action_timeout"),
  v.literal("pdf_download_failed"),
  v.literal("pdf_invalid"),
  v.literal("paper_not_found"),
  v.literal("indexing_failed"),
  v.literal("llm_content_refusal"),
  v.literal("schema_validation"),
  v.literal("cancelled"),
);

/** Chat-side alias for ErrorCode; chat envelopes only emit the first 10 codes. */
export type ChatErrorClass = ErrorCode;

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

/**
 * Per-code retryability — the intrinsic taxonomy property. UI policy
 * (whether to expose a retry button to the user) is a separate concern
 * layered on top via `requiresUserEdit` / `requiresAdminAction` plus
 * any UX-level gating the consumer wants.
 */
export const isRetryable: Record<ErrorCode, boolean> = {
  insufficient_credits: true,
  rate_limit: true,
  model_unavailable: true,
  auth: false,
  moderation: false,
  context_too_long: false,
  network: true,
  provider_5xx: true,
  aborted: true,
  unknown: true,
  action_timeout: true,
  pdf_download_failed: true,
  pdf_invalid: false,
  paper_not_found: false,
  indexing_failed: true,
  llm_content_refusal: false,
  schema_validation: false,
  cancelled: false,
};

const REQUIRES_EDIT: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "moderation",
  "context_too_long",
]);
const REQUIRES_ATTENTION: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "insufficient_credits",
  "auth",
]);

export function requiresUserEdit(envelope: ChatErrorEnvelope): boolean {
  return REQUIRES_EDIT.has(envelope.class);
}

export function requiresAdminAction(envelope: ChatErrorEnvelope): boolean {
  return REQUIRES_ATTENTION.has(envelope.class);
}

/* ─────────────────── classifyUnknownError + ClassifiedError ─────────────────── */

export type ClassifiedError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  providerName?: string;
  context?: unknown;
};

/** Maps an upstream error string code to its taxonomy entry. */
const CODE_TO_TAXONOMY: Record<string, ErrorCode> = {
  INSUFFICIENT_CREDITS: "insufficient_credits",
  AI_INSUFFICIENT_CREDITS: "insufficient_credits",
};

/**
 * Universal error → taxonomy classifier. Accepts anything thrown at a
 * Convex action / mutation / Next.js route boundary and returns a
 * structured ClassifiedError. Designed to be safe against arbitrary
 * shapes; never throws.
 */
export function classifyUnknownError(err: unknown): ClassifiedError {
  const data = extractData(err);
  const message = extractClassifiableMessage(err, data);
  const context = captureContext(data);

  // 1. Explicit code match against ConvexError.data.code or err.code.
  const explicitCode = typeof data?.code === "string" ? data.code : undefined;
  if (explicitCode && CODE_TO_TAXONOMY[explicitCode]) {
    return finalize(CODE_TO_TAXONOMY[explicitCode], message, { context });
  }

  // 2. Prefix-message fallback: "INSUFFICIENT_CREDITS: …" → insufficient_credits.
  const prefixMatch = /^([A-Z][A-Z0-9_]+):/.exec(message);
  if (prefixMatch && CODE_TO_TAXONOMY[prefixMatch[1]]) {
    return finalize(CODE_TO_TAXONOMY[prefixMatch[1]], message, { context });
  }

  // 3. AbortError / AbortSignal — user-initiated stop.
  const errName = err instanceof Error ? err.name : "";
  if (errName === "AbortError") {
    return finalize("aborted", message, { context });
  }

  // 4. Network failures: TypeError "fetch failed" + node-style transport errors.
  if (errName === "TypeError" && /fetch failed/i.test(message)) {
    return finalize("network", message, { context });
  }
  if (
    /\bnetwork( request)? failed\b|socket hang up|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(
      message,
    )
  ) {
    return finalize("network", message, { context });
  }

  // 5. HTTP status fingerprints (AI SDK uses statusCode, fetch Response uses status).
  const httpStatus = extractHttpStatus(data);
  if (typeof httpStatus === "number") {
    if (httpStatus === 429) return finalize("rate_limit", message, { httpStatus, context });
    if (httpStatus === 402) {
      return finalize("insufficient_credits", message, { httpStatus, context });
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return finalize("auth", message, { httpStatus, context });
    }
    if (httpStatus >= 500 && httpStatus < 600) {
      return finalize("provider_5xx", message, { httpStatus, context });
    }
  }

  // 6. Message-shaped fingerprints — last resort before "unknown".
  for (const { pattern, code } of MESSAGE_FINGERPRINTS) {
    if (pattern.test(message)) {
      return finalize(code, message, { context });
    }
  }

  return finalize("unknown", message, { context });
}

/** Pattern → taxonomy code, evaluated in order. First match wins. */
const MESSAGE_FINGERPRINTS: ReadonlyArray<{ pattern: RegExp; code: ErrorCode }> = [
  { pattern: /content filter|moderation|safety classifier/i, code: "moderation" },
  {
    pattern: /context length|context_length|token limit|too long for|maximum context/i,
    code: "context_too_long",
  },
  { pattern: /timed out|deadline (?:exceeded|reached)/i, code: "action_timeout" },
];

function extractHttpStatus(
  data: Record<string, unknown> | undefined,
): number | undefined {
  if (!data) return undefined;
  const raw = data.statusCode ?? data.status;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 100 && raw < 600) {
    return raw;
  }
  return undefined;
}

function extractData(err: unknown): Record<string, unknown> | undefined {
  if (err instanceof ConvexError) {
    return err.data && typeof err.data === "object"
      ? (err.data as Record<string, unknown>)
      : undefined;
  }
  if (err && typeof err === "object") return err as Record<string, unknown>;
  return undefined;
}

const CONTEXT_BYTE_CAP = 4096;
const ALREADY_EXTRACTED_FIELDS = new Set([
  "code",
  "message",
  "statusCode",
  "status",
  "name",
  "stack",
]);

/**
 * Capture every own-enumerable field on the error/data payload that we
 * haven't already lifted into a top-level taxonomy field, then bound the
 * serialised size at 4 KB so a pathological context can't bloat a Convex
 * doc past the 1 MB row limit.
 */
function captureContext(
  source: Record<string, unknown> | undefined,
): unknown {
  if (!source) return undefined;
  const ownProps: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (ALREADY_EXTRACTED_FIELDS.has(key)) continue;
    ownProps[key] = source[key];
  }
  if (Object.keys(ownProps).length === 0) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(ownProps);
  } catch {
    return undefined;
  }
  if (serialized === "{}" || serialized === "null") return undefined;
  if (serialized.length <= CONTEXT_BYTE_CAP) return ownProps;
  return {
    _truncated: true,
    preview: serialized.slice(0, CONTEXT_BYTE_CAP - 200),
    originalLength: serialized.length,
  };
}

function extractClassifiableMessage(
  err: unknown,
  data: Record<string, unknown> | undefined,
): string {
  const fromData = typeof data?.message === "string" ? data.message : undefined;
  if (fromData && fromData.length > 0) return fromData;
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return "Unknown error";
}

function finalize(
  code: ErrorCode,
  message: string,
  extras: { httpStatus?: number; providerName?: string; context?: unknown } = {},
): ClassifiedError {
  const { httpStatus, providerName, context } = extras;
  return {
    code,
    message: truncate(message, 500),
    retryable: isRetryable[code],
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(providerName !== undefined ? { providerName } : {}),
    ...(context !== undefined ? { context } : {}),
  };
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
