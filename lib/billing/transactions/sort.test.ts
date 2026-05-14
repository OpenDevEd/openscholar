import { describe, expect, it } from "vitest";

import { sortRows } from "./sort";
import type { TransactionViewModel } from "./transaction-view-model";

function row(
  partial: Partial<TransactionViewModel> & Pick<TransactionViewModel, "id">,
): TransactionViewModel {
  return {
    id: partial.id,
    type: partial.type ?? "purchase",
    creditType: partial.creditType ?? "paid",
    billingType: partial.billingType ?? null,
    direction: partial.direction ?? "in",
    amount: partial.amount ?? 100,
    signedAmount: partial.signedAmount ?? 100,
    description: partial.description ?? null,
    createdAt: partial.createdAt ?? 0,
    jobId: partial.jobId ?? null,
    paperId: partial.paperId ?? null,
    resultId: partial.resultId ?? null,
    stripeInvoiceId: partial.stripeInvoiceId ?? null,
    stripePaymentIntentId: partial.stripePaymentIntentId ?? null,
    stripeChargeId: partial.stripeChargeId ?? null,
    stripeCheckoutSessionId: partial.stripeCheckoutSessionId ?? null,
    metadata: partial.metadata ?? {},
    hasStripe: partial.hasStripe ?? false,
    paperTitle: partial.paperTitle ?? null,
    jobName: partial.jobName ?? null,
    openalexRef: partial.openalexRef ?? null,
    modelLabel: partial.modelLabel ?? null,
    tokenSummary: partial.tokenSummary ?? null,
  };
}

describe("sortRows", () => {
  it("sorts by date descending (newest first)", () => {
    const input = [
      row({ id: "a", createdAt: 1_000 }),
      row({ id: "b", createdAt: 3_000 }),
      row({ id: "c", createdAt: 2_000 }),
    ];
    const result = sortRows(input, "date", "desc");
    expect(result.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by amount ascending (most negative spend first)", () => {
    const input = [
      row({ id: "a", signedAmount: 50 }),
      row({ id: "b", signedAmount: -100 }),
      row({ id: "c", signedAmount: 200 }),
      row({ id: "d", signedAmount: -25 }),
    ];
    const result = sortRows(input, "amount", "asc");
    expect(result.map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("sorts by type ascending and preserves insertion order on ties (stable)", () => {
    const input = [
      row({ id: "u1", type: "usage" }),
      row({ id: "p1", type: "purchase" }),
      row({ id: "u2", type: "usage" }),
      row({ id: "g1", type: "grant" }),
      row({ id: "p2", type: "purchase" }),
    ];
    const result = sortRows(input, "type", "asc");
    expect(result.map((r) => r.id)).toEqual(["g1", "p1", "p2", "u1", "u2"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      row({ id: "a", createdAt: 1 }),
      row({ id: "b", createdAt: 2 }),
    ];
    const snapshot = input.map((r) => r.id);
    sortRows(input, "date", "desc");
    expect(input.map((r) => r.id)).toEqual(snapshot);
  });
});
