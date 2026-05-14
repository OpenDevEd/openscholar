import { describe, it, expect } from "vitest";
import type { Doc } from "@/convex/_generated/dataModel";
import { toViewModel } from "./transaction-view-model";

function makeDoc(
  overrides: Partial<Doc<"creditTransactions">> = {},
): Doc<"creditTransactions"> {
  return {
    _id: "txn_1" as Doc<"creditTransactions">["_id"],
    _creationTime: 0,
    creditsId: "credits_1" as Doc<"creditTransactions">["creditsId"],
    type: "purchase",
    creditType: "paid",
    amount: 100,
    createdAt: 1_000_000,
    ...overrides,
  };
}

describe("toViewModel", () => {
  it("projects direction out for negative amounts, and reports the abs amount", () => {
    const vm = toViewModel(makeDoc({ type: "usage", amount: -500 }));
    expect(vm.direction).toBe("out");
    expect(vm.amount).toBe(500);
    expect(vm.signedAmount).toBe(-500);
  });

  it("projects direction in for non-negative amounts", () => {
    const vmIn = toViewModel(makeDoc({ amount: 100 }));
    expect(vmIn.direction).toBe("in");
    expect(vmIn.amount).toBe(100);
    expect(vmIn.signedAmount).toBe(100);

    const vmZero = toViewModel(makeDoc({ amount: 0 }));
    expect(vmZero.direction).toBe("in");
    expect(vmZero.amount).toBe(0);
  });

  it("hasStripe true when stripeInvoiceId is set", () => {
    const vm = toViewModel(makeDoc({ stripeInvoiceId: "in_abc" }));
    expect(vm.hasStripe).toBe(true);
    expect(vm.stripeInvoiceId).toBe("in_abc");
  });

  it("hasStripe true when stripePaymentIntentId is set", () => {
    const vm = toViewModel(makeDoc({ stripePaymentIntentId: "pi_abc" }));
    expect(vm.hasStripe).toBe(true);
  });

  it("hasStripe true when stripeChargeId is set", () => {
    const vm = toViewModel(makeDoc({ stripeChargeId: "ch_abc" }));
    expect(vm.hasStripe).toBe(true);
  });

  it("hasStripe true when stripeCheckoutSessionId is set", () => {
    const vm = toViewModel(makeDoc({ stripeCheckoutSessionId: "cs_abc" }));
    expect(vm.hasStripe).toBe(true);
  });

  it("hasStripe false when none of the stripe* fields are set", () => {
    const vm = toViewModel(makeDoc());
    expect(vm.hasStripe).toBe(false);
    expect(vm.stripeInvoiceId).toBeNull();
    expect(vm.stripePaymentIntentId).toBeNull();
    expect(vm.stripeChargeId).toBeNull();
    expect(vm.stripeCheckoutSessionId).toBeNull();
  });

  it("coerces undefined description to null", () => {
    const vm = toViewModel(makeDoc({ description: undefined }));
    expect(vm.description).toBeNull();
  });

  it("preserves a non-empty description string", () => {
    const vm = toViewModel(makeDoc({ description: "Stripe invoice" }));
    expect(vm.description).toBe("Stripe invoice");
  });

  it("coerces undefined metadata to an empty object", () => {
    const vm = toViewModel(makeDoc({ metadata: undefined }));
    expect(vm.metadata).toEqual({});
  });

  it("passes through a populated metadata record", () => {
    const vm = toViewModel(
      makeDoc({ metadata: { invoice_line: "line_1" } }),
    );
    expect(vm.metadata).toEqual({ invoice_line: "line_1" });
  });

  it("coerces undefined billingType to null", () => {
    const vm = toViewModel(makeDoc({ billingType: undefined }));
    expect(vm.billingType).toBeNull();
  });

  it("preserves a populated billingType", () => {
    const vm = toViewModel(makeDoc({ billingType: "extraction_llm" }));
    expect(vm.billingType).toBe("extraction_llm");
  });

  it("carries the id from _id", () => {
    const vm = toViewModel(makeDoc());
    expect(vm.id).toBe("txn_1");
  });

  it("copies createdAt unchanged", () => {
    const vm = toViewModel(makeDoc({ createdAt: 42 }));
    expect(vm.createdAt).toBe(42);
  });
});
