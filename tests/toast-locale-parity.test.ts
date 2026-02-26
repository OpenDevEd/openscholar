import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["en-US", "en-GB", "fr", "hi", "ja", "zh"] as const;

const NEW_TOAST_KEYS = [
  "openBilling",
  "openPricing",
  "convexUnknownError",
  "convexAuthRequired",
  "convexPermissionDenied",
  "extractionPlanRequired",
  "convexNotFound",
  "convexInvalidInput",
  "convexInsufficientCredits",
  "aiUnauthenticated",
  "aiInsufficientCredits",
  "aiPlanEntitlement",
  "aiApiKeyRequired",
  "aiProviderError",
  "aiValidationError",
  "aiMaxRetriesExceeded",
  "apiKeyInvalidFormat",
  "apiKeyEncryptionMisconfigured",
  "zoteroNotConnected",
  "zoteroOauthNotConfigured",
  "zoteroRequestTokenFailed",
  "zoteroInvalidResponse",
  "zoteroApiError",
  "billingNoSubscriptionLinked",
  "billingSubscriptionDataInvalid",
  "billingSubscriptionInvalid",
  "billingAuthenticationFailed",
  "billingNetworkError",
  "billingRateLimited",
  "billingStripeError",
  "billingPlanChangeConflict",
  "billingInvalidPrice",
  "billingCancelRequiresPortal",
  "billingNoActiveSubscription",
  "creditsTopupBundleInvalid",
  "creditsProductMisconfigured",
] as const;

function readMessages(locale: (typeof LOCALES)[number]) {
  const filePath = path.resolve(process.cwd(), `messages/${locale}.json`);
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    toast?: Record<string, unknown>;
  };
}

describe("toast locale parity", () => {
  for (const locale of LOCALES) {
    it(`${locale} includes all new toast keys`, () => {
      const messages = readMessages(locale);
      const toast = messages.toast ?? {};

      for (const key of NEW_TOAST_KEYS) {
        expect(toast, `${locale} missing toast.${key}`).toHaveProperty(key);
      }
    });
  }
});
