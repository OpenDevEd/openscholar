import { describe, expect, it } from "vitest";
import {
  classifyChatError,
  isRetryable,
  parseChatError,
  requiresAdminAction,
  requiresUserEdit,
  serializeChatError,
  type ChatErrorEnvelope,
} from "@/lib/chat/error-classifier";

describe("classifyChatError", () => {
  it("maps HTTP 429 with OpenRouter body to rate_limit + retryAfter", () => {
    const envelope = classifyChatError({
      name: "TooManyRequestsResponseError",
      message: "Provider returned error",
      statusCode: 429,
      responseHeaders: new Headers({ "retry-after": "20" }),
      body: JSON.stringify({
        error: {
          message: "Provider returned error",
          code: 429,
          metadata: {
            raw: "google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream.",
            provider_name: "Google AI Studio",
            is_byok: false,
          },
        },
      }),
    });

    expect(envelope.class).toBe("rate_limit");
    expect(envelope.httpStatus).toBe(429);
    expect(envelope.retryAfterMs).toBe(20_000);
    expect(envelope.providerName).toBe("Google AI Studio");
    expect(envelope.message).toContain("gemma-4");
  });

  it("maps 401/403 without moderation hints to auth", () => {
    const envelope = classifyChatError({
      statusCode: 401,
      message: "Invalid API key",
    });
    expect(envelope.class).toBe("auth");
    expect(isRetryable(envelope)).toBe(false);
    expect(requiresAdminAction(envelope)).toBe(true);
  });

  it("maps 403 with moderation metadata to moderation", () => {
    const envelope = classifyChatError({
      statusCode: 403,
      message: "Flagged by content filter",
      body: JSON.stringify({
        error: {
          code: 403,
          metadata: { reasons: ["hate_speech"], flagged_input: true },
        },
      }),
    });
    expect(envelope.class).toBe("moderation");
    expect(requiresUserEdit(envelope)).toBe(true);
  });

  it("maps 402 and our custom AI_INSUFFICIENT_CREDITS to insufficient_credits", () => {
    expect(classifyChatError({ statusCode: 402, message: "No credits" }).class).toBe(
      "insufficient_credits",
    );
    expect(
      classifyChatError({ code: "AI_INSUFFICIENT_CREDITS", message: "Not enough credits for this chat message." }).class,
    ).toBe("insufficient_credits");
  });

  it("maps 503/502 to model_unavailable", () => {
    expect(classifyChatError({ statusCode: 503, message: "no provider" }).class).toBe(
      "model_unavailable",
    );
    expect(classifyChatError({ statusCode: 502, message: "bad gateway" }).class).toBe(
      "model_unavailable",
    );
  });

  it("maps 400 with context-length cue to context_too_long", () => {
    const envelope = classifyChatError({
      statusCode: 400,
      message: "Request exceeds maximum context length for this model",
    });
    expect(envelope.class).toBe("context_too_long");
    expect(requiresUserEdit(envelope)).toBe(true);
  });

  it("maps generic 5xx to provider_5xx", () => {
    expect(classifyChatError({ statusCode: 500 }).class).toBe("provider_5xx");
  });

  it("detects network errors by fetch-failure message patterns", () => {
    expect(classifyChatError({ message: "fetch failed" }).class).toBe("network");
    expect(classifyChatError({ message: "socket hang up" }).class).toBe("network");
  });

  it("detects aborts by AbortError name", () => {
    const envelope = classifyChatError({
      name: "AbortError",
      message: "The operation was aborted.",
    });
    expect(envelope.class).toBe("aborted");
    expect(isRetryable(envelope)).toBe(false);
  });

  it("falls back to unknown for unrecognised shapes", () => {
    const envelope = classifyChatError({ message: "something weird happened" });
    expect(envelope.class).toBe("unknown");
    expect(isRetryable(envelope)).toBe(true);
  });

  it("truncates extremely long raw messages", () => {
    const longMsg = "x".repeat(2000);
    const envelope = classifyChatError({ message: longMsg });
    expect(envelope.message.length).toBeLessThanOrEqual(500);
  });
});

describe("serializeChatError / parseChatError", () => {
  it("roundtrips a classified envelope", () => {
    const envelope = classifyChatError({
      statusCode: 429,
      message: "Too many requests",
      responseHeaders: { "retry-after": "15" },
    });
    const wire = serializeChatError(envelope);
    const roundtripped = parseChatError(wire);
    expect(roundtripped).toEqual(envelope);
  });

  it("wraps legacy plain-string errors as class:unknown with the raw text", () => {
    const parsed = parseChatError("Response failed");
    expect(parsed).not.toBeNull();
    expect(parsed?.class).toBe("unknown");
    expect(parsed?.message).toBe("Response failed");
  });

  it("returns null for null/undefined/empty input", () => {
    expect(parseChatError(null)).toBeNull();
    expect(parseChatError(undefined)).toBeNull();
    expect(parseChatError("")).toBeNull();
  });

  it("recovers from a corrupted envelope by falling back to unknown", () => {
    const junk = "__chat_err_v1__:{not-json}";
    const parsed = parseChatError(junk);
    expect(parsed?.class).toBe("unknown");
    // The junk string itself is treated as the raw message — we wrap the
    // entire input to avoid losing information.
    expect(parsed?.message).toContain("chat_err_v1");
  });
});

describe("action helpers", () => {
  it.each([
    ["rate_limit", true, false, false],
    ["model_unavailable", true, false, false],
    ["network", true, false, false],
    ["provider_5xx", true, false, false],
    ["unknown", true, false, false],
    ["aborted", false, false, false],
    ["moderation", false, true, false],
    ["context_too_long", false, true, false],
    ["auth", false, false, true],
    ["insufficient_credits", false, false, true],
  ] as const)("class %s: retry=%s edit=%s admin=%s", (cls, retry, edit, admin) => {
    const envelope: ChatErrorEnvelope = {
      version: 1,
      class: cls,
      message: "m",
    };
    expect(isRetryable(envelope)).toBe(retry);
    expect(requiresUserEdit(envelope)).toBe(edit);
    expect(requiresAdminAction(envelope)).toBe(admin);
  });
});
