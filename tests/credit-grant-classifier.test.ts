import { describe, expect, it } from "vitest";
import { classifyMonthlyCreditInvoice } from "../convex/credits/lib/invoiceGrantPolicy";

describe("credit grant classifier", () => {
  it("grants on subscription_create", () => {
    const result = classifyMonthlyCreditInvoice({
      stripeSubscriptionId: "sub_123",
      invoiceStatus: "paid",
      invoiceBillingReason: "subscription_create",
    });
    expect(result.decision).toBe("grant");
  });

  it("grants on subscription_cycle", () => {
    const result = classifyMonthlyCreditInvoice({
      stripeSubscriptionId: "sub_123",
      invoiceStatus: "paid",
      invoiceBillingReason: "subscription_cycle",
    });
    expect(result.decision).toBe("grant");
  });

  it("ignores subscription_update as non-recurring", () => {
    const result = classifyMonthlyCreditInvoice({
      stripeSubscriptionId: "sub_123",
      invoiceStatus: "paid",
      invoiceBillingReason: "subscription_update",
    });
    expect(result.decision).toBe("ignore_non_recurring");
    expect(result.classification).toBe("ignored_non_recurring_reason");
  });

  it("treats missing billing reason on paid subscription invoice as config drift", () => {
    const result = classifyMonthlyCreditInvoice({
      stripeSubscriptionId: "sub_123",
      invoiceStatus: "paid",
      invoiceBillingReason: undefined,
      stripeApiVersion: "2025-10-29.clover",
    });
    expect(result.decision).toBe("ignore_config_drift");
  });

  it("uses retry_with_reconcile when invoice is not yet paid", () => {
    const result = classifyMonthlyCreditInvoice({
      stripeSubscriptionId: "sub_123",
      invoiceStatus: "open",
      invoiceBillingReason: "subscription_cycle",
    });
    expect(result.decision).toBe("retry_with_reconcile");
  });
});

describe("upgrade resilience firewall", () => {
  it("subscription_update never triggers monthly credit grant (UPGR-03)", () => {
    const result = classifyMonthlyCreditInvoice({
      stripeSubscriptionId: "sub_123",
      invoiceStatus: "paid",
      invoiceBillingReason: "subscription_update",
    });

    // CRITICAL: subscription_update must ALWAYS be classified as non-recurring.
    // If this changes, upgrade proration invoices would trigger both a monthly
    // credit grant AND an upgrade pro-rata grant, causing double-grants.
    expect(result.decision).toBe("ignore_non_recurring");
    expect(result.classification).toBe("ignored_non_recurring_reason");
  });
});
