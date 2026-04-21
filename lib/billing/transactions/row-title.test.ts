import { describe, it, expect } from "vitest";
import { resolveTitle } from "./row-title";
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

describe("resolveTitle — packed types", () => {
  it("purchase packs amount into translated title", () => {
    const t = resolveTitle(row({ type: "purchase", direction: "in", amount: 50_000 }));
    expect(t).toEqual({
      kind: "translated",
      key: "titles.paidCredits",
      values: { amount: 50_000 },
      source: "purchase-packed",
    });
  });

  it("grant packs amount into translated title", () => {
    const t = resolveTitle(row({ type: "grant", direction: "in", amount: 500 }));
    expect(t.kind).toBe("translated");
    expect(t).toMatchObject({ key: "titles.freeCredits", source: "grant-packed" });
  });

  it("refund uses refund title", () => {
    const t = resolveTitle(row({ type: "refund", direction: "in", amount: 50 }));
    expect(t).toMatchObject({ key: "titles.refund", source: "refund-packed" });
  });

  it("expiry packs amount into expired title", () => {
    const t = resolveTitle(row({ type: "expiry", amount: 100 }));
    expect(t).toMatchObject({
      key: "titles.freeCreditsExpired",
      source: "expiry-packed",
    });
  });
});

describe("resolveTitle — usage", () => {
  it("chat → translated 'chat message' (title is not the paper)", () => {
    const t = resolveTitle(row({ type: "usage", billingType: "chat" }));
    expect(t).toEqual({
      kind: "translated",
      key: "titles.chatMessage",
      source: "chat",
    });
  });

  it("prefers paperTitle when present (screening)", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: "screening",
        paperTitle: "Attention Is All You Need",
      }),
    );
    expect(t).toEqual({
      kind: "literal",
      text: "Attention Is All You Need",
      source: "paper-title",
    });
  });

  it("prefers paperTitle over jobName when both are present", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: "extraction_llm",
        paperTitle: "Paper X",
        jobName: "Systematic Review 2026",
      }),
    );
    expect(t.source).toBe("paper-title");
  });

  it("falls back to jobName when paperTitle missing", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: "extraction_llm",
        jobName: "Systematic Review 2026",
      }),
    );
    expect(t).toEqual({
      kind: "literal",
      text: "Systematic Review 2026",
      source: "job-name",
    });
  });

  it("falls back to openalex ref when titles missing", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: "screening",
        openalexRef: "W2335322260",
      }),
    );
    expect(t).toEqual({
      kind: "translated",
      key: "titles.paperRef",
      values: { ref: "W2335322260" },
      source: "openalex-ref",
    });
  });

  it("falls back to service label when nothing is known (screening)", () => {
    const t = resolveTitle(row({ type: "usage", billingType: "screening" }));
    expect(t).toEqual({
      kind: "translated",
      key: "titles.screening",
      source: "service-fallback",
    });
  });

  it("falls back to service label (extraction_llm)", () => {
    const t = resolveTitle(row({ type: "usage", billingType: "extraction_llm" }));
    expect(t).toMatchObject({ kind: "translated", key: "titles.extraction" });
  });

  it("falls back to service label (embedding)", () => {
    const t = resolveTitle(row({ type: "usage", billingType: "embedding" }));
    expect(t).toMatchObject({ kind: "translated", key: "titles.indexing" });
  });

  it("falls back to service label (search)", () => {
    const t = resolveTitle(row({ type: "usage", billingType: "search" }));
    expect(t).toEqual({
      kind: "translated",
      key: "titles.search",
      source: "service-fallback",
    });
  });

  it("falls back to service label (translation)", () => {
    const t = resolveTitle(row({ type: "usage", billingType: "translation" }));
    expect(t).toEqual({
      kind: "translated",
      key: "titles.translation",
      source: "service-fallback",
    });
  });

  it("wallet_api packs model label into title (model is the point, not the paper)", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: "wallet_api",
        modelLabel: "GPT 4o Mini",
      }),
    );
    expect(t).toEqual({
      kind: "translated",
      key: "titles.walletApi",
      values: { model: "GPT 4o Mini" },
      source: "wallet-api",
    });
  });

  it("wallet_api without model → generic walletApi title", () => {
    const t = resolveTitle(row({ type: "usage", billingType: "wallet_api" }));
    expect(t).toMatchObject({
      kind: "translated",
      key: "titles.walletApiGeneric",
      source: "service-fallback",
    });
  });

  it("translation prefers paperTitle when present", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: "translation",
        paperTitle: "A Paper To Translate",
      }),
    );
    expect(t).toEqual({
      kind: "literal",
      text: "A Paper To Translate",
      source: "paper-title",
    });
  });

  it("falls back to description (stripped 'AI:' prefix) when typed billingType is null", () => {
    const t = resolveTitle(
      row({ type: "usage", billingType: null, description: "AI: Enhance search query" }),
    );
    expect(t).toEqual({
      kind: "literal",
      text: "Enhance search query",
      source: "description",
    });
  });

  it("falls back to description without AI prefix untouched", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: null,
        description: "Regenerate screening rubric",
      }),
    );
    expect(t).toMatchObject({
      kind: "literal",
      text: "Regenerate screening rubric",
      source: "description",
    });
  });

  it("falls back to generic type.usage only when billingType AND description are absent", () => {
    const t = resolveTitle(row({ type: "usage", billingType: null, description: null }));
    expect(t).toMatchObject({ key: "type.usage", source: "service-fallback" });
  });

  it("preserves service-fallback when typed billingType is set, even if a description also exists", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: "screening",
        description: "AI: Something else",
        paperTitle: null,
        jobName: null,
        openalexRef: null,
      }),
    );
    expect(t).toMatchObject({ key: "titles.screening", source: "service-fallback" });
  });

  it("trims whitespace-only paperTitle / jobName as missing", () => {
    const t = resolveTitle(
      row({
        type: "usage",
        billingType: "screening",
        paperTitle: "   ",
        jobName: "\n\n",
        openalexRef: "W111",
      }),
    );
    expect(t.source).toBe("openalex-ref");
  });
});
