import { describe, expect, it } from "vitest";
import {
  resolveCreditsAvailability,
  resolveErrorCode,
  resolveExecutionDecision,
  resolveFallbackToLocal,
  resolveModeConfigurability,
  shouldRetrySmartWithLocalFallback,
} from "../lib/ai/client/mode-routing";

describe("ai mode routing", () => {
  describe("resolveModeConfigurability", () => {
    it("requires key for local mode", () => {
      expect(
        resolveModeConfigurability({
          mode: "local",
          hasApiKey: false,
          creditsEnabled: true,
          isAuthenticated: true,
        }),
      ).toBe(false);
      expect(
        resolveModeConfigurability({
          mode: "local",
          hasApiKey: true,
          creditsEnabled: true,
          isAuthenticated: false,
        }),
      ).toBe(true);
    });

    it("always reports credits mode as configurable", () => {
      expect(
        resolveModeConfigurability({
          mode: "credits",
          hasApiKey: false,
          creditsEnabled: false,
          isAuthenticated: false,
        }),
      ).toBe(true);
    });

    it("uses smart configurability rule", () => {
      expect(
        resolveModeConfigurability({
          mode: "smart",
          hasApiKey: false,
          creditsEnabled: true,
          isAuthenticated: true,
        }),
      ).toBe(true);
      expect(
        resolveModeConfigurability({
          mode: "smart",
          hasApiKey: false,
          creditsEnabled: false,
          isAuthenticated: true,
        }),
      ).toBe(false);
    });
  });

  describe("resolveExecutionDecision", () => {
    it("routes smart mode to credits when authenticated and credits are available/unknown", () => {
      expect(
        resolveExecutionDecision({
          mode: "smart",
          hasApiKey: false,
          creditsEnabled: true,
          isAuthenticated: true,
          creditsAvailability: "available",
        }),
      ).toEqual({ type: "execute", target: "credits" });

      expect(
        resolveExecutionDecision({
          mode: "smart",
          hasApiKey: false,
          creditsEnabled: true,
          isAuthenticated: true,
          creditsAvailability: "unknown",
        }),
      ).toEqual({ type: "execute", target: "credits" });
    });

    it("routes smart mode to local when credits are unavailable and BYOK key exists", () => {
      expect(
        resolveExecutionDecision({
          mode: "smart",
          hasApiKey: true,
          creditsEnabled: true,
          isAuthenticated: true,
          creditsAvailability: "unavailable",
        }),
      ).toEqual({ type: "execute", target: "local" });
    });

    it("returns insufficient credits for smart mode with no key and unavailable credits", () => {
      expect(
        resolveExecutionDecision({
          mode: "smart",
          hasApiKey: false,
          creditsEnabled: true,
          isAuthenticated: true,
          creditsAvailability: "unavailable",
        }),
      ).toEqual({ type: "error", reason: "insufficient_credits" });
    });

    it("uses BYOK for unauthenticated smart mode", () => {
      expect(
        resolveExecutionDecision({
          mode: "smart",
          hasApiKey: true,
          creditsEnabled: true,
          isAuthenticated: false,
          creditsAvailability: "unknown",
        }),
      ).toEqual({ type: "execute", target: "local" });

      expect(
        resolveExecutionDecision({
          mode: "smart",
          hasApiKey: false,
          creditsEnabled: true,
          isAuthenticated: false,
          creditsAvailability: "unknown",
        }),
      ).toEqual({ type: "error", reason: "api_key_required" });
    });

    it("treats credits-disabled as hard disable for credits mode", () => {
      expect(
        resolveExecutionDecision({
          mode: "credits",
          hasApiKey: true,
          creditsEnabled: false,
          isAuthenticated: true,
          creditsAvailability: "available",
        }),
      ).toEqual({ type: "error", reason: "credits_disabled" });
    });

    it("falls back to local requirements in smart mode when credits are disabled", () => {
      expect(
        resolveExecutionDecision({
          mode: "smart",
          hasApiKey: true,
          creditsEnabled: false,
          isAuthenticated: true,
          creditsAvailability: "available",
        }),
      ).toEqual({ type: "execute", target: "local" });

      expect(
        resolveExecutionDecision({
          mode: "smart",
          hasApiKey: false,
          creditsEnabled: false,
          isAuthenticated: true,
          creditsAvailability: "available",
        }),
      ).toEqual({ type: "error", reason: "api_key_required" });
    });
  });

  describe("smart fallback eligibility", () => {
    it("allows fallback only for smart mode on auth/credit failure codes when key exists", () => {
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "smart",
          hasApiKey: true,
          errorCode: "AI_UNAUTHENTICATED",
        }),
      ).toBe(true);
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "smart",
          hasApiKey: true,
          errorCode: "INSUFFICIENT_CREDITS",
        }),
      ).toBe(true);
    });

    it("blocks fallback for non-smart, missing-key, or unrelated codes", () => {
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "local",
          hasApiKey: true,
          errorCode: "AI_UNAUTHENTICATED",
        }),
      ).toBe(false);
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "smart",
          hasApiKey: false,
          errorCode: "AI_UNAUTHENTICATED",
        }),
      ).toBe(false);
      expect(
        shouldRetrySmartWithLocalFallback({
          mode: "smart",
          hasApiKey: true,
          errorCode: "AI_PROVIDER_ERROR",
        }),
      ).toBe(false);
    });
  });

  describe("resolveFallbackToLocal", () => {
    it("blocks the local fallback when allowSmartLocalFallback is false even with otherwise-eligible smart inputs", () => {
      expect(
        resolveFallbackToLocal({
          allowSmartLocalFallback: false,
          mode: "smart",
          hasApiKey: true,
          errorCode: "AI_INSUFFICIENT_CREDITS",
        }),
      ).toBe(false);
    });
  });

  describe("resolveCreditsAvailability", () => {
    it("compares balance against the required credit estimate", () => {
      expect(
        resolveCreditsAvailability({
          isAuthenticated: true,
          settlement: "settled",
          totalCredits: 5,
          requiredCredits: 10,
        }),
      ).toBe("unavailable");

      expect(
        resolveCreditsAvailability({
          isAuthenticated: true,
          settlement: "settled",
          totalCredits: 100,
          requiredCredits: 10,
        }),
      ).toBe("available");
    });

    it("keeps unsettled balances unknown instead of guessing from zero", () => {
      expect(
        resolveCreditsAvailability({
          isAuthenticated: true,
          settlement: "loading",
          totalCredits: 0,
          requiredCredits: 10,
        }),
      ).toBe("unknown");

      expect(
        resolveCreditsAvailability({
          isAuthenticated: true,
          settlement: "loading",
          totalCredits: 100,
          requiredCredits: 10,
        }),
      ).toBe("unknown");
    });
  });

  describe("resolveErrorCode", () => {
    it("reads structured code from data.code", () => {
      expect(
        resolveErrorCode({ data: { code: "AI_INSUFFICIENT_CREDITS" } }),
      ).toBe("AI_INSUFFICIENT_CREDITS");
    });

    it("reads structured code from error.code", () => {
      expect(resolveErrorCode({ code: "AI_CREDITS_DISABLED" })).toBe(
        "AI_CREDITS_DISABLED",
      );
    });

    it("reads uppercase string payload code", () => {
      expect(resolveErrorCode({ data: "UNAUTHENTICATED" })).toBe(
        "UNAUTHENTICATED",
      );
    });

    it("returns undefined when no code is present", () => {
      expect(resolveErrorCode(new Error("something else"))).toBeUndefined();
    });
  });
});
