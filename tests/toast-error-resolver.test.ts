import { describe, expect, it } from "vitest";
import {
  getToastMessageKeyForErrorCode,
  isPlanUpgradeCode,
  resolveToastError,
} from "../lib/toast/error-resolver";

describe("toast error resolver", () => {
  it("uses Convex error data.code when present", () => {
    const resolved = resolveToastError(
      {
        message: "[CONVEX A(ai/actions:generateExtractionQuestions)] Called by client",
        data: { code: "AI_INSUFFICIENT_CREDITS", message: "Insufficient credits for AI operation" },
      },
      "fallback",
    );

    expect(resolved.code).toBe("AI_INSUFFICIENT_CREDITS");
    expect(getToastMessageKeyForErrorCode(resolved.code)).toBe("aiInsufficientCredits");
  });

  it("sanitizes legacy Convex hybrid stack text", () => {
    const resolved = resolveToastError(
      "[CONVEX A(ai/actions:generateExtractionQuestions)] [Request ID: abc123] Server Error Uncaught AIInsufficientCreditsError: Insufficient credits for AI operation Called by client",
      "fallback",
    );

    expect(resolved.code).toBe("AI_INSUFFICIENT_CREDITS");
    expect(resolved.message).not.toContain("[CONVEX");
    expect(resolved.message).not.toContain("Called by client");
  });

  it("falls back to generic text for unknown Convex errors", () => {
    const fallback = "Something went wrong.";
    const resolved = resolveToastError(
      "[CONVEX A(foo/bar:baz)] [Request ID: abc123] Server Error Uncaught UnknownFailure Called by client",
      fallback,
    );

    expect(resolved.isConvex).toBe(true);
    expect(resolved.code).toBeUndefined();
    expect(resolved.message).toBe(fallback);
  });

  it("prioritizes structured AI code over raw message text", () => {
    const resolved = resolveToastError(
      {
        message: "AIProviderError: upstream timeout",
        data: { code: "AI_PLAN_ENTITLEMENT", message: "This feature requires the Go plan or higher" },
      },
      "fallback",
    );

    expect(resolved.code).toBe("AI_PLAN_ENTITLEMENT");
    expect(getToastMessageKeyForErrorCode(resolved.code)).toBe("aiPlanEntitlement");
  });

  it("maps extraction entitlement code to localized toast key", () => {
    const resolved = resolveToastError(
      {
        message: "Uncaught ConvexError",
        data: { code: "EXTRACTION_PLAN_REQUIRED" },
      },
      "fallback",
    );

    expect(resolved.code).toBe("EXTRACTION_PLAN_REQUIRED");
    expect(getToastMessageKeyForErrorCode(resolved.code)).toBe("extractionPlanRequired");
    expect(isPlanUpgradeCode(resolved.code)).toBe(true);
  });

  it("resolves top-level client error.code and maps credits disabled message key", () => {
    const resolved = resolveToastError(
      {
        code: "AI_CREDITS_DISABLED",
        message: "Credits mode is disabled",
      },
      "fallback",
    );

    expect(resolved.code).toBe("AI_CREDITS_DISABLED");
    expect(getToastMessageKeyForErrorCode(resolved.code)).toBe("aiCreditsDisabled");
  });
});
