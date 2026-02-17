import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyMonthlyCreditInvoice,
  ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS,
  isEligibleMonthlyCreditBillingReason,
} from "../convex/credits/lib/invoiceGrantPolicy";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("credit grant billing reason policy", () => {
  it("allows strict modern recurring/new subscription invoice reasons only", () => {
    expect(ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS).toEqual([
      "subscription_create",
      "subscription_cycle",
    ]);

    expect(isEligibleMonthlyCreditBillingReason("subscription_create")).toBe(true);
    expect(isEligibleMonthlyCreditBillingReason("subscription_cycle")).toBe(true);
  });

  it("rejects non-recurring invoice reasons", () => {
    expect(isEligibleMonthlyCreditBillingReason("subscription")).toBe(false);
    expect(isEligibleMonthlyCreditBillingReason("subscription_update")).toBe(false);
    expect(isEligibleMonthlyCreditBillingReason("manual")).toBe(false);
    expect(isEligibleMonthlyCreditBillingReason("quote_accept")).toBe(false);
    expect(isEligibleMonthlyCreditBillingReason(undefined)).toBe(false);
  });

  it("classifies missing billing reason as configuration drift for paid subscription invoices", () => {
    const decision = classifyMonthlyCreditInvoice({
      invoiceStatus: "paid",
      stripeSubscriptionId: "sub_123",
      invoiceBillingReason: undefined,
      stripeApiVersion: "2025-10-29.clover",
    });

    expect(decision.decision).toBe("ignore_config_drift");
    expect(decision.classification).toBe("config_drift_missing_billing_reason");
  });

  it("is enforced by monthly grant implementation", () => {
    const source = readSource("convex/credits/internal.ts");
    expect(source).toMatch(/classifyMonthlyCreditInvoice/);
    expect(source).toMatch(/markStripeEventFailed/);
  });
});
