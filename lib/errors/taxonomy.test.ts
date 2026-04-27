import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import {
  classifyChatError,
  classifyUnknownError,
  ERROR_CODES,
  errorCodeValidator,
  isRetryable,
  parseChatError,
  requiresAdminAction,
  requiresUserEdit,
  serializeChatError,
  type ChatErrorEnvelope,
} from "@/lib/errors/taxonomy";
import { ABORT_ERROR_STRING } from "@/lib/chat/abort-signal";

describe("ERROR_CODES taxonomy", () => {
  it("is a 19-entry tuple covering chat + extraction codes", () => {
    expect(ERROR_CODES).toEqual([
      "insufficient_credits",
      "rate_limit",
      "model_unavailable",
      "auth",
      "moderation",
      "context_too_long",
      "network",
      "provider_5xx",
      "regenerate_failed",
      "aborted",
      "unknown",
      "action_timeout",
      "pdf_download_failed",
      "pdf_invalid",
      "paper_not_found",
      "indexing_failed",
      "llm_content_refusal",
      "schema_validation",
      "cancelled",
    ]);
    expect(ERROR_CODES).toHaveLength(19);
  });
});

describe("isRetryable record", () => {
  it.each([
    ["insufficient_credits", true],
    ["rate_limit", true],
    ["model_unavailable", true],
    ["auth", false],
    ["moderation", false],
    ["context_too_long", false],
    ["network", true],
    ["provider_5xx", true],
    ["regenerate_failed", true],
    ["aborted", true],
    ["unknown", true],
    ["action_timeout", true],
    ["pdf_download_failed", true],
    ["pdf_invalid", false],
    ["paper_not_found", false],
    ["indexing_failed", true],
    ["llm_content_refusal", false],
    ["schema_validation", false],
    ["cancelled", false],
  ] as const)("isRetryable[%s] === %s", (code, expected) => {
    expect(isRetryable[code]).toBe(expected);
  });

  it("covers every ERROR_CODES entry with a boolean", () => {
    for (const code of ERROR_CODES) {
      expect(typeof isRetryable[code]).toBe("boolean");
    }
  });
});

describe("classifyUnknownError — ConvexError fingerprints", () => {
  it("R5: ConvexError carrying data.code INSUFFICIENT_CREDITS → insufficient_credits", () => {
    const err = new ConvexError({
      code: "INSUFFICIENT_CREDITS",
      message: "Wallet balance is 12, need 50",
    });
    const result = classifyUnknownError(err);
    expect(result.code).toBe("insufficient_credits");
    expect(result.message).toContain("Wallet balance");
    expect(result.retryable).toBe(true);
  });

  it("R5: ConvexError carrying data.code AI_INSUFFICIENT_CREDITS → insufficient_credits", () => {
    const err = new ConvexError({
      code: "AI_INSUFFICIENT_CREDITS",
      message: "Insufficient credits for AI operation",
    });
    expect(classifyUnknownError(err).code).toBe("insufficient_credits");
  });

  it("R6: ConvexError with INSUFFICIENT_CREDITS: prefix in data.message → insufficient_credits", () => {
    const err = new ConvexError({ message: "INSUFFICIENT_CREDITS: need 50" });
    const result = classifyUnknownError(err);
    expect(result.code).toBe("insufficient_credits");
    expect(result.message).toContain("need 50");
  });
});

describe("classifyUnknownError — fingerprint cascade", () => {
  it("R7: DOMException with name 'AbortError' → aborted", () => {
    const err = Object.assign(new Error("Operation was aborted"), {
      name: "AbortError",
    });
    const result = classifyUnknownError(err);
    expect(result.code).toBe("aborted");
  });

  it("R7: AbortSignal-style DOMException → aborted", () => {
    const err = new Error("AbortSignal triggered");
    err.name = "AbortError";
    expect(classifyUnknownError(err).code).toBe("aborted");
  });

  it("R7b: rehydrated `new Error(serializedAbortSentinel)` → aborted (the extraction onComplete shape)", () => {
    // convex/extraction/mutations/internal/onComplete.ts wraps stored
    // error strings into Error instances before classifying. When the
    // stored string is the agent's persisted abort sentinel, the
    // resulting Error has name "Error" — not "AbortError" — and the
    // sentinel only as message. The R7 name-only check used to miss
    // this and the job was misclassified as "unknown".
    expect(
      classifyUnknownError(new Error(`${ABORT_ERROR_STRING}`)).code,
    ).toBe("aborted");
    expect(
      classifyUnknownError(
        new Error(
          `Trying to update a message that failed: msg_42, error: ${ABORT_ERROR_STRING}`,
        ),
      ).code,
    ).toBe("aborted");
  });

  it("R8: TypeError with 'fetch failed' message → network", () => {
    const err = new TypeError("fetch failed");
    expect(classifyUnknownError(err).code).toBe("network");
  });

  it("R8: Error with /network|socket hang up|ENOTFOUND/i message → network", () => {
    expect(classifyUnknownError(new Error("network request failed")).code).toBe(
      "network",
    );
    expect(classifyUnknownError(new Error("socket hang up")).code).toBe(
      "network",
    );
    expect(
      classifyUnknownError(new Error("getaddrinfo ENOTFOUND api.foo")).code,
    ).toBe("network");
  });

  it("R9: httpStatus 429 → rate_limit", () => {
    const result = classifyUnknownError(
      Object.assign(new Error("Too many requests"), { statusCode: 429 }),
    );
    expect(result.code).toBe("rate_limit");
    expect(result.httpStatus).toBe(429);
  });

  it("R9: 'status' field also picked up (fetch Response style)", () => {
    expect(
      classifyUnknownError(
        Object.assign(new Error("Too many"), { status: 429 }),
      ).code,
    ).toBe("rate_limit");
  });

  it("R10: httpStatus 503 → provider_5xx", () => {
    const result = classifyUnknownError(
      Object.assign(new Error("Service unavailable"), { statusCode: 503 }),
    );
    expect(result.code).toBe("provider_5xx");
    expect(result.httpStatus).toBe(503);
  });

  it("R10: httpStatus 500 / 502 / 504 → provider_5xx", () => {
    for (const s of [500, 502, 504] as const) {
      expect(
        classifyUnknownError(
          Object.assign(new Error("oops"), { statusCode: s }),
        ).code,
      ).toBe("provider_5xx");
    }
  });

  it("R11: httpStatus 401 → auth", () => {
    const result = classifyUnknownError(
      Object.assign(new Error("Invalid API key"), { statusCode: 401 }),
    );
    expect(result.code).toBe("auth");
    expect(result.retryable).toBe(false);
  });

  it("R11: httpStatus 403 → auth", () => {
    expect(
      classifyUnknownError(
        Object.assign(new Error("Forbidden"), { statusCode: 403 }),
      ).code,
    ).toBe("auth");
  });

  it("R11: httpStatus 402 → insufficient_credits", () => {
    expect(
      classifyUnknownError(
        Object.assign(new Error("Payment required"), { statusCode: 402 }),
      ).code,
    ).toBe("insufficient_credits");
  });

  it("R12: message /content filter|moderation|safety/i → moderation", () => {
    expect(
      classifyUnknownError(new Error("flagged by content filter")).code,
    ).toBe("moderation");
    expect(
      classifyUnknownError(new Error("Output blocked by moderation policy"))
        .code,
    ).toBe("moderation");
    expect(
      classifyUnknownError(new Error("Safety classifier triggered")).code,
    ).toBe("moderation");
  });

  it("R13: message /context length|token limit|too long/i → context_too_long", () => {
    expect(
      classifyUnknownError(new Error("Maximum context length is 32k tokens"))
        .code,
    ).toBe("context_too_long");
    expect(classifyUnknownError(new Error("Token limit exceeded")).code).toBe(
      "context_too_long",
    );
    expect(
      classifyUnknownError(new Error("Input is too long for this model")).code,
    ).toBe("context_too_long");
  });

  it("R14: message /timed out|deadline/i → action_timeout", () => {
    expect(
      classifyUnknownError(new Error("Request timed out after 600s")).code,
    ).toBe("action_timeout");
    expect(classifyUnknownError(new Error("Deadline exceeded")).code).toBe(
      "action_timeout",
    );
  });

  it("R15: unrecognised shapes fall through to unknown / retryable:true", () => {
    const result = classifyUnknownError(new Error("Some weird thing happened"));
    expect(result.code).toBe("unknown");
    expect(result.retryable).toBe(true);
  });

  it("R15: classifyUnknownError(undefined) → unknown without throwing", () => {
    expect(classifyUnknownError(undefined).code).toBe("unknown");
  });

  it("R15: classifyUnknownError(string) → unknown with the string as message", () => {
    const result = classifyUnknownError("a stringified error");
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("a stringified error");
  });
});

describe("classifyUnknownError — full ERROR_CODES coverage", () => {
  it("round-trips every ErrorCode via uppercased explicit data.code", () => {
    for (const code of ERROR_CODES) {
      const err = new ConvexError({ code: code.toUpperCase(), message: "x" });
      expect(classifyUnknownError(err).code).toBe(code);
    }
  });
});

describe("classifyUnknownError — context bounds", () => {
  it("R16: serialized context is bounded at ≤ 4KB", () => {
    const big = "x".repeat(8000);
    const err = Object.assign(new Error("with attached context"), {
      payload: { huge: big, nested: { huge2: big } },
    });
    const result = classifyUnknownError(err);
    if (result.context !== undefined) {
      const serialized = JSON.stringify(result.context);
      expect(serialized.length).toBeLessThanOrEqual(4096);
    }
  });

  it("R16: small structured context is preserved as-is", () => {
    const err = Object.assign(new Error("small ctx"), {
      payload: { paperId: "abc-123", attempt: 2 },
    });
    const result = classifyUnknownError(err);
    expect(result.context).toBeDefined();
    const serialized = JSON.stringify(result.context);
    expect(serialized.length).toBeLessThanOrEqual(4096);
  });
});

describe("errorCodeValidator", () => {
  it("R17: is a v.union of literals covering every ERROR_CODES entry", () => {
    expect(errorCodeValidator.kind).toBe("union");
    expect(errorCodeValidator.members).toHaveLength(ERROR_CODES.length);
    const literalValues = errorCodeValidator.members.map((m) => m.value);
    for (const code of ERROR_CODES) {
      expect(literalValues).toContain(code);
    }
  });

  it("R17: members are all literal validators", () => {
    for (const m of errorCodeValidator.members) {
      expect(m.kind).toBe("literal");
    }
  });
});

describe("classifyChatError", () => {
  it("parses the current chat abort sentinel as aborted", () => {
    const envelope = parseChatError(ABORT_ERROR_STRING);

    expect(envelope).toEqual({
      version: 1,
      class: "aborted",
      message: ABORT_ERROR_STRING,
    });
  });

  it("parses the current agent failed-message update wrapper as aborted", () => {
    const raw = `Trying to update a message that failed: ks7fm4y0axy6ad5g8pfdmtq00x85f2m5, error: ${ABORT_ERROR_STRING}`;

    expect(parseChatError(raw)).toEqual({
      version: 1,
      class: "aborted",
      message: raw,
    });
  });

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
    expect(isRetryable[envelope.class]).toBe(false);
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
    expect(
      classifyChatError({ statusCode: 402, message: "No credits" }).class,
    ).toBe("insufficient_credits");
    expect(
      classifyChatError({
        code: "AI_INSUFFICIENT_CREDITS",
        message: "Not enough credits for this chat message.",
      }).class,
    ).toBe("insufficient_credits");
    expect(
      classifyChatError(
        new ConvexError({
          code: "AI_INSUFFICIENT_CREDITS",
          message: "Not enough credits for this chat message.",
        }),
      ).class,
    ).toBe("insufficient_credits");
  });

  it("maps 503/502 to model_unavailable", () => {
    expect(
      classifyChatError({ statusCode: 503, message: "no provider" }).class,
    ).toBe("model_unavailable");
    expect(
      classifyChatError({ statusCode: 502, message: "bad gateway" }).class,
    ).toBe("model_unavailable");
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
    expect(classifyChatError({ message: "fetch failed" }).class).toBe(
      "network",
    );
    expect(classifyChatError({ message: "socket hang up" }).class).toBe(
      "network",
    );
  });

  it("detects only the user-stop AbortError sentinel as aborted", () => {
    const envelope = classifyChatError({
      name: "AbortError",
      message: "user_stopped",
    });
    expect(envelope.class).toBe("aborted");
    // Aborts are retryable in the unified taxonomy — the request itself
    // is not broken, the user just stopped it. UI consumers that want to
    // suppress an automatic retry button on abort should gate separately.
    expect(isRetryable[envelope.class]).toBe(true);
  });

  it("does not swallow provider AbortError failures as user-stopped turns", () => {
    const envelope = classifyChatError({
      name: "AbortError",
      message: "upstream request aborted before response headers",
    });
    expect(envelope.class).toBe("unknown");
    expect(envelope.message).toContain("upstream request aborted");
  });

  it("falls back to unknown for unrecognised shapes", () => {
    const envelope = classifyChatError({ message: "something weird happened" });
    expect(envelope.class).toBe("unknown");
    expect(isRetryable[envelope.class]).toBe(true);
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

describe("envelope-bound chat helpers", () => {
  it.each([
    ["rate_limit", false, false],
    ["model_unavailable", false, false],
    ["network", false, false],
    ["provider_5xx", false, false],
    ["regenerate_failed", false, false],
    ["unknown", false, false],
    ["aborted", false, false],
    ["moderation", true, false],
    ["context_too_long", true, false],
    ["auth", false, true],
    ["insufficient_credits", false, true],
  ] as const)("class %s: edit=%s admin=%s", (cls, edit, admin) => {
    const envelope: ChatErrorEnvelope = {
      version: 1,
      class: cls,
      message: "m",
    };
    expect(requiresUserEdit(envelope)).toBe(edit);
    expect(requiresAdminAction(envelope)).toBe(admin);
  });
});
