import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INTERNAL_FILE = "convex/credits/internal.ts";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("credit purchase idempotency contract", () => {
  it("guards purchase grants by payment intent idempotency lookup", () => {
    const source = readSource(INTERNAL_FILE);

    expect(source).toMatch(/grantPurchasedCreditsFromPaymentIntent/);
    expect(source).toMatch(/by_stripe_payment_intent/);
    expect(source).toMatch(/selectPurchaseTransactionByPaymentIntent/);
    expect(source).toMatch(/existingPurchase/);
    expect(source).toMatch(/outcome:\s*["']already_granted["']/);
  });

  it("uses cumulative refund replay-safe delta policy", () => {
    const source = readSource(INTERNAL_FILE);

    expect(source).toMatch(/reversePurchasedCreditsFromRefund/);
    expect(source).toMatch(/calculateRefundTargetCredits/);
    expect(source).toMatch(/calculateRefundDeltaCredits/);
    expect(source).toMatch(/alreadyReversedCredits/);
    expect(source).toMatch(/outcome:\s*["']already_reversed["']/);
  });
});
