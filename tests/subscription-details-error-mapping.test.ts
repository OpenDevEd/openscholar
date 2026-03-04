import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { mapSubscriptionDetailsErrorCode } from "../convex/subscriptions/actions";

function makeStripeError<T extends Error>(ctor: new (...args: unknown[]) => T): T {
  return Object.create(ctor.prototype) as T;
}

describe("subscription details error-code mapping", () => {
  it("maps Stripe invalid request errors to BILLING_SUBSCRIPTION_INVALID", () => {
    const error = makeStripeError(Stripe.errors.StripeInvalidRequestError);
    expect(mapSubscriptionDetailsErrorCode(error)).toBe("BILLING_SUBSCRIPTION_INVALID");
  });

  it("maps Stripe authentication errors to BILLING_AUTHENTICATION_FAILED", () => {
    const error = makeStripeError(Stripe.errors.StripeAuthenticationError);
    expect(mapSubscriptionDetailsErrorCode(error)).toBe("BILLING_AUTHENTICATION_FAILED");
  });

  it("maps Stripe network errors to BILLING_NETWORK_ERROR", () => {
    const error = makeStripeError(Stripe.errors.StripeConnectionError);
    expect(mapSubscriptionDetailsErrorCode(error)).toBe("BILLING_NETWORK_ERROR");
  });

  it("maps Stripe rate-limit errors to BILLING_RATE_LIMITED", () => {
    const error = makeStripeError(Stripe.errors.StripeRateLimitError);
    expect(mapSubscriptionDetailsErrorCode(error)).toBe("BILLING_RATE_LIMITED");
  });

  it("maps unknown errors to BILLING_STRIPE_ERROR", () => {
    expect(mapSubscriptionDetailsErrorCode(new Error("boom"))).toBe("BILLING_STRIPE_ERROR");
  });
});
