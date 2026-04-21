import { describe, it, expect } from "vitest";
import { resolveSecondaryParts } from "./row-secondary";
import type { TransactionViewModel } from "./transaction-view-model";

function row(overrides: Partial<TransactionViewModel> = {}): TransactionViewModel {
  return {
    id: "tx_1",
    type: "usage",
    creditType: "paid",
    billingType: null,
    direction: "out",
    amount: 4,
    signedAmount: -4,
    balanceAfter: 1_000,
    description: null,
    createdAt: 0,
    jobId: null,
    paperId: null,
    resultId: null,
    stripeInvoiceId: null,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    stripeCheckoutSessionId: null,
    metadata: {},
    hasStripe: false,
    paperTitle: null,
    jobName: null,
    openalexRef: null,
    modelLabel: null,
    tokenSummary: null,
    ...overrides,
  };
}

describe("resolveSecondaryParts", () => {
  it("purchase without Stripe → just 'topup'", () => {
    expect(
      resolveSecondaryParts(row({ type: "purchase", direction: "in", hasStripe: false })),
    ).toEqual([{ kind: "translated", key: "secondary.topup" }]);
  });

  it("purchase with Stripe → 'topup · stripe'", () => {
    expect(
      resolveSecondaryParts(
        row({ type: "purchase", direction: "in", hasStripe: true }),
      ),
    ).toEqual([
      { kind: "translated", key: "secondary.topup" },
      { kind: "translated", key: "secondary.stripe" },
    ]);
  });

  it("grant with source metadata → literal source", () => {
    expect(
      resolveSecondaryParts(
        row({ type: "grant", direction: "in", metadata: { grantSource: "Welcome bonus" } }),
      ),
    ).toEqual([{ kind: "literal", text: "Welcome bonus" }]);
  });

  it("grant without source → empty", () => {
    expect(resolveSecondaryParts(row({ type: "grant", direction: "in" }))).toEqual([]);
  });

  it("refund with Stripe → 'stripeRefund'", () => {
    expect(
      resolveSecondaryParts(row({ type: "refund", direction: "in", hasStripe: true })),
    ).toEqual([{ kind: "translated", key: "secondary.stripeRefund" }]);
  });

  it("refund without Stripe → empty", () => {
    expect(
      resolveSecondaryParts(row({ type: "refund", direction: "in", hasStripe: false })),
    ).toEqual([]);
  });

  it("expiry → 'expired'", () => {
    expect(resolveSecondaryParts(row({ type: "expiry" }))).toEqual([
      { kind: "translated", key: "secondary.expired" },
    ]);
  });

  it("usage:chat with model + tokens → [literal model, literal tokens]", () => {
    expect(
      resolveSecondaryParts(
        row({
          type: "usage",
          billingType: "chat",
          modelLabel: "Gemini Flash Lite",
          tokenSummary: "31K in / 273 out",
        }),
      ),
    ).toEqual([
      { kind: "literal", text: "Gemini Flash Lite" },
      { kind: "literal", text: "31K in / 273 out" },
    ]);
  });

  it("usage:chat with just model → only model literal", () => {
    expect(
      resolveSecondaryParts(
        row({ type: "usage", billingType: "chat", modelLabel: "GPT 4o" }),
      ),
    ).toEqual([{ kind: "literal", text: "GPT 4o" }]);
  });

  it("usage:screening → service key", () => {
    expect(
      resolveSecondaryParts(row({ type: "usage", billingType: "screening" })),
    ).toEqual([{ kind: "translated", key: "billingType.screening" }]);
  });

  it("usage:extraction_llm → service key", () => {
    expect(
      resolveSecondaryParts(row({ type: "usage", billingType: "extraction_llm" })),
    ).toEqual([{ kind: "translated", key: "billingType.extraction_llm" }]);
  });

  it("usage:embedding → service key", () => {
    expect(
      resolveSecondaryParts(row({ type: "usage", billingType: "embedding" })),
    ).toEqual([{ kind: "translated", key: "billingType.embedding" }]);
  });

  it("usage:search → service key", () => {
    expect(
      resolveSecondaryParts(row({ type: "usage", billingType: "search" })),
    ).toEqual([{ kind: "translated", key: "billingType.search" }]);
  });

  it("usage:translation → service key", () => {
    expect(
      resolveSecondaryParts(row({ type: "usage", billingType: "translation" })),
    ).toEqual([{ kind: "translated", key: "billingType.translation" }]);
  });

  it("usage:wallet_api with model + tokens → [literal model, literal tokens] (model-centric like chat)", () => {
    expect(
      resolveSecondaryParts(
        row({
          type: "usage",
          billingType: "wallet_api",
          modelLabel: "Claude Sonnet",
          tokenSummary: "12K in / 345 out",
        }),
      ),
    ).toEqual([
      { kind: "literal", text: "Claude Sonnet" },
      { kind: "literal", text: "12K in / 345 out" },
    ]);
  });

  it("usage:wallet_api without model → falls back to wallet_api service key", () => {
    expect(
      resolveSecondaryParts(row({ type: "usage", billingType: "wallet_api" })),
    ).toEqual([{ kind: "translated", key: "billingType.wallet_api" }]);
  });

  it("usage with no billingType → empty", () => {
    expect(
      resolveSecondaryParts(row({ type: "usage", billingType: null })),
    ).toEqual([]);
  });
});
