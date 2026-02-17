import { describe, expect, it } from "vitest";
import { selectReconcileInvoiceCandidates } from "../convex/credits/actions";

describe("credit reconcile selection", () => {
  it("selects paid subscription invoices for backfill", () => {
    const candidates = selectReconcileInvoiceCandidates({
      cutoffUnixSeconds: 1_700_000_000,
      invoices: [
        {
          id: "in_eligible",
          status: "paid",
          created: 1_700_000_100,
          billing_reason: "subscription_cycle",
          subscription: "sub_123",
          amount_paid: 2000,
        },
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.invoiceId).toBe("in_eligible");
  });

  it("ignores non-paid invoices", () => {
    const candidates = selectReconcileInvoiceCandidates({
      cutoffUnixSeconds: 1_700_000_000,
      invoices: [
        {
          id: "in_open",
          status: "open",
          created: 1_700_000_100,
          subscription: "sub_123",
        },
      ],
    });

    expect(candidates).toHaveLength(0);
  });

  it("keeps paid invoices even when subscription pointer is missing (hydration fallback path)", () => {
    const candidates = selectReconcileInvoiceCandidates({
      cutoffUnixSeconds: 1_700_000_000,
      invoices: [
        {
          id: "in_no_sub",
          status: "paid",
          created: 1_700_000_100,
          subscription: null,
        },
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.invoiceId).toBe("in_no_sub");
  });

  it("deduplicates duplicate invoice deliveries by invoice id", () => {
    const candidates = selectReconcileInvoiceCandidates({
      cutoffUnixSeconds: 1_700_000_000,
      invoices: [
        {
          id: "in_dup",
          status: "paid",
          created: 1_700_000_100,
          subscription: "sub_123",
        },
        {
          id: "in_dup",
          status: "paid",
          created: 1_700_000_200,
          subscription: "sub_123",
        },
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.invoiceId).toBe("in_dup");
  });
});
