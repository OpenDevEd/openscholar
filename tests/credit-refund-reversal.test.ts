import { describe, expect, it } from "vitest";
import {
  calculateRefundDeltaCredits,
  calculateRefundTargetCredits,
} from "../convex/lib/creditTopups";

describe("credit refund reversal policy", () => {
  it("computes proportional target credits from cumulative refunded amount", () => {
    const target = calculateRefundTargetCredits({
      purchasedCredits: 1_000,
      purchaseAmountCents: 1_000,
      refundedAmountCents: 250,
    });

    expect(target).toBe(250);
  });

  it("caps target reversal at full purchased credits for full/over refunds", () => {
    expect(
      calculateRefundTargetCredits({
        purchasedCredits: 1_000,
        purchaseAmountCents: 1_000,
        refundedAmountCents: 1_000,
      }),
    ).toBe(1_000);

    expect(
      calculateRefundTargetCredits({
        purchasedCredits: 1_000,
        purchaseAmountCents: 1_000,
        refundedAmountCents: 1_500,
      }),
    ).toBe(1_000);
  });

  it("computes replay-safe delta against already reversed credits", () => {
    const target = calculateRefundTargetCredits({
      purchasedCredits: 1_000,
      purchaseAmountCents: 1_000,
      refundedAmountCents: 500,
    });

    expect(
      calculateRefundDeltaCredits({
        targetReversedCredits: target,
        alreadyReversedCredits: 300,
      }),
    ).toBe(200);

    expect(
      calculateRefundDeltaCredits({
        targetReversedCredits: target,
        alreadyReversedCredits: 500,
      }),
    ).toBe(0);
  });
});
