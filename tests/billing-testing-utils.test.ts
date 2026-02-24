import { describe, expect, it } from "vitest";
import { collectBillingStripeObjectIds } from "../convex/testing/billing";

describe("billing testing object-id collection", () => {
  it("collects and deduplicates stripe object identifiers across billing tables", () => {
    const result = collectBillingStripeObjectIds({
      subscriptions: [
        {
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_1",
        },
        {
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_2",
        },
      ],
      billingCustomers: [
        { stripeCustomerId: "cus_1" },
        { stripeCustomerId: "cus_2" },
      ],
      creditTransactions: [
        {
          stripeInvoiceId: "in_1",
          stripePaymentIntentId: "pi_1",
          stripeChargeId: "ch_1",
        },
        {
          stripeInvoiceId: "in_1",
          stripePaymentIntentId: "pi_2",
          stripeChargeId: "ch_2",
        },
      ],
    });

    expect(new Set(result.stripeCustomerIds)).toEqual(new Set(["cus_1", "cus_2"]));
    expect(new Set(result.stripeSubscriptionIds)).toEqual(new Set(["sub_1", "sub_2"]));
    expect(new Set(result.stripeInvoiceIds)).toEqual(new Set(["in_1"]));
    expect(new Set(result.stripePaymentIntentIds)).toEqual(new Set(["pi_1", "pi_2"]));
    expect(new Set(result.stripeChargeIds)).toEqual(new Set(["ch_1", "ch_2"]));
  });

  it("returns empty collections when no stripe references are present", () => {
    const result = collectBillingStripeObjectIds({
      subscriptions: [],
      billingCustomers: [],
      creditTransactions: [],
    });

    expect(result).toEqual({
      stripeCustomerIds: [],
      stripeSubscriptionIds: [],
      stripeInvoiceIds: [],
      stripePaymentIntentIds: [],
      stripeChargeIds: [],
    });
  });
});
