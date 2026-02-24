import { describe, expect, it } from "vitest";
import { normalizeStripeWebhookSecret } from "../convex/lib/stripeWebhookSecret";

describe("stripe webhook secret normalization", () => {
  it("returns undefined for empty values", () => {
    expect(normalizeStripeWebhookSecret(undefined)).toBeUndefined();
    expect(normalizeStripeWebhookSecret(null)).toBeUndefined();
    expect(normalizeStripeWebhookSecret("")).toBeUndefined();
    expect(normalizeStripeWebhookSecret("   ")).toBeUndefined();
  });

  it("trims and strips wrapping quotes", () => {
    const secret = "whsec_example";
    expect(normalizeStripeWebhookSecret(`  "${secret}"  `)).toBe(secret);
    expect(normalizeStripeWebhookSecret(`  '${secret}'  `)).toBe(secret);
  });

  it("extracts whsec token from labeled copy/paste text", () => {
    expect(
      normalizeStripeWebhookSecret("webhook secret: whsec_labeled_value"),
    ).toBe("whsec_labeled_value");
  });
});
