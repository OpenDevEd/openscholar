import { describe, expect, it } from "vitest";
import { extractSubscriptionIdFromInvoiceLike } from "../convex/credits/actions";

describe("invoice hydration subscription resolution", () => {
  it("uses invoice.subscription when present", () => {
    const subscriptionId = extractSubscriptionIdFromInvoiceLike({
      id: "in_1",
      created: 1_700_000_100,
      status: "paid",
      subscription: "sub_direct",
    });

    expect(subscriptionId).toBe("sub_direct");
  });

  it("falls back to subscription pointer from invoice lines", () => {
    const subscriptionId = extractSubscriptionIdFromInvoiceLike({
      id: "in_2",
      created: 1_700_000_100,
      status: "paid",
      subscription: null,
      lines: {
        data: [
          {
            parent: {
              subscription_item_details: {
                subscription: "sub_from_line_parent",
              },
            },
          },
        ],
      },
    });

    expect(subscriptionId).toBe("sub_from_line_parent");
  });

  it("returns undefined when no subscription pointer exists", () => {
    const subscriptionId = extractSubscriptionIdFromInvoiceLike({
      id: "in_3",
      created: 1_700_000_100,
      status: "paid",
      subscription: null,
      lines: { data: [] },
    });

    expect(subscriptionId).toBeUndefined();
  });
});
