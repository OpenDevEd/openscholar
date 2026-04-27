import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";

import { hasEnoughCredits } from "@/lib/credits/availability";

/**
 * Tests for the three credit-guard fixes:
 *
 * 1. throwStructuredAIError normalizes INSUFFICIENT_CREDITS -> AI_INSUFFICIENT_CREDITS
 * 2. withAuthAndCreditsBatch rejects when balance < minimumRequired (batch pre-flight)
 * 3. shouldRetrySmartWithLocalFallback handles both error codes consistently
 *
 * These are pure-function tests — no AI credits, no API calls, no Convex runtime.
 */

// ---- Inline the logic under test from convex/ai/helpers.ts ----
// We cannot import helpers.ts directly (it imports Convex server bindings
// that are unavailable in the Node test runner). Instead we extract the
// exact same logic into testable form.

function hasStructuredConvexCode(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: unknown }).data;
  return Boolean(
    data &&
      typeof data === "object" &&
      "code" in data &&
      typeof (data as { code?: unknown }).code === "string",
  );
}

function createError(code: string, message: string) {
  return new ConvexError({ code, message });
}

/**
 * Mirror of throwStructuredAIError's normalization logic.
 * Returns the error code that the upstream chain would see.
 */
function normalizeErrorCode(error: unknown): string {
  if (hasStructuredConvexCode(error)) {
    const code = (error as { data: { code: string } }).data.code;
    if (code === "INSUFFICIENT_CREDITS") {
      return "AI_INSUFFICIENT_CREDITS";
    }
    return code;
  }
  return "UNKNOWN";
}

// ---- Re-import the actual pure routing functions ----
import { shouldRetrySmartWithLocalFallback } from "../lib/ai/client/mode-routing";

describe("credit guard fixes", () => {
  describe("throwStructuredAIError normalization (fix #2)", () => {
    it("normalizes bare INSUFFICIENT_CREDITS to AI_INSUFFICIENT_CREDITS", () => {
      const error = createError("INSUFFICIENT_CREDITS", "need 10, have 0");
      expect(normalizeErrorCode(error)).toBe("AI_INSUFFICIENT_CREDITS");
    });

    it("passes through AI_INSUFFICIENT_CREDITS unchanged", () => {
      const error = createError("AI_INSUFFICIENT_CREDITS", "Insufficient credits");
      expect(normalizeErrorCode(error)).toBe("AI_INSUFFICIENT_CREDITS");
    });

    it("passes through other structured codes unchanged", () => {
      const error = createError("AI_PROVIDER_ERROR", "provider down");
      expect(normalizeErrorCode(error)).toBe("AI_PROVIDER_ERROR");
    });

    it("passes through NOT_FOUND unchanged", () => {
      const error = createError("NOT_FOUND", "no credits record");
      expect(normalizeErrorCode(error)).toBe("NOT_FOUND");
    });
  });

  describe("batch pre-flight check (fix #1)", () => {
    // Contract test: the AI helper trio's gate composes hasEnoughCredits
    // from lib/credits/availability. wouldRejectBatch === !hasEnoughCredits.
    function wouldRejectBatch(
      balance: { total: number } | null,
      minimumRequired: number,
    ): boolean {
      return !hasEnoughCredits({ balance, required: minimumRequired });
    }

    it("rejects when balance is less than papers.length", () => {
      expect(wouldRejectBatch({ total: 5 }, 20)).toBe(true);
    });

    it("rejects when balance is null", () => {
      expect(wouldRejectBatch(null, 1)).toBe(true);
    });

    it("rejects when balance is 0 and minimumRequired is 1", () => {
      expect(wouldRejectBatch({ total: 0 }, 1)).toBe(true);
    });

    it("accepts when balance exactly equals minimumRequired", () => {
      expect(wouldRejectBatch({ total: 20 }, 20)).toBe(false);
    });

    it("accepts when balance exceeds minimumRequired", () => {
      expect(wouldRejectBatch({ total: 100 }, 20)).toBe(false);
    });

    it("defaults to minimumRequired=1 for single operations", () => {
      // Old behavior: balance.total <= 0 was the check
      // New behavior: balance.total < 1 is equivalent
      expect(wouldRejectBatch({ total: 0 }, 1)).toBe(true);
      expect(wouldRejectBatch({ total: 1 }, 1)).toBe(false);
    });
  });

  describe("smart fallback handles both error codes after normalization (fix #2 + routing)", () => {
    it("triggers fallback on AI_INSUFFICIENT_CREDITS (pre-flight error)", () => {
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "smart",
          hasApiKey: true,
          errorCode: "AI_INSUFFICIENT_CREDITS",
        }),
      ).toBe(true);
    });

    it("triggers fallback on INSUFFICIENT_CREDITS (deductCredits race)", () => {
      // This is the code that NOW gets normalized to AI_INSUFFICIENT_CREDITS
      // by throwStructuredAIError before it reaches the client. But the
      // fallback set also includes the bare code for defense in depth.
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "smart",
          hasApiKey: true,
          errorCode: "INSUFFICIENT_CREDITS",
        }),
      ).toBe(true);
    });

    it("does NOT trigger fallback without an API key", () => {
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "smart",
          hasApiKey: false,
          errorCode: "AI_INSUFFICIENT_CREDITS",
        }),
      ).toBe(false);
    });

    it("does NOT trigger fallback in credits mode", () => {
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "credits",
          hasApiKey: true,
          errorCode: "AI_INSUFFICIENT_CREDITS",
        }),
      ).toBe(false);
    });

    it("does NOT trigger fallback for unrelated error codes", () => {
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "smart",
          hasApiKey: true,
          errorCode: "AI_PROVIDER_ERROR",
        }),
      ).toBe(false);
    });
  });

  describe("screening idempotency guard (fix #3)", () => {
    /**
     * Simulates the idempotency check added to screenPaperAction:
     *   if (result.status === "completed") -> skip
     */
    function shouldSkipPaper(resultStatus: string): boolean {
      return resultStatus === "completed";
    }

    it("skips already-completed results (prevents double-billing on retry)", () => {
      expect(shouldSkipPaper("completed")).toBe(true);
    });

    it("processes pending results", () => {
      expect(shouldSkipPaper("pending")).toBe(false);
    });

    it("processes in-progress results", () => {
      expect(shouldSkipPaper("processing")).toBe(false);
    });

    it("processes failed results (retry after transient failure)", () => {
      expect(shouldSkipPaper("failed")).toBe(false);
    });
  });
});
