import { describe, expect, it } from "vitest";
import { computeSearchableText } from "./search-text";

describe("computeSearchableText", () => {
  it("joins description + type, lowercased, with spaces", () => {
    expect(
      computeSearchableText({
        description: "Stripe purchase",
        type: "purchase",
      }),
    ).toBe("stripe purchase purchase");
  });

  it("includes metadata.model when present", () => {
    expect(
      computeSearchableText({
        description: "chat call",
        metadata: { model: "gpt-4o-mini" },
        billingType: "chat",
        type: "usage",
      }),
    ).toBe("chat call gpt-4o-mini chat usage");
  });

  it("includes metadata.openalexId when present", () => {
    expect(
      computeSearchableText({
        description: "embedding",
        metadata: { openalexId: "W1234" },
        billingType: "embedding",
        type: "usage",
      }),
    ).toBe("embedding w1234 embedding usage");
  });

  it("omits description when null or undefined, does not stringify as 'null'", () => {
    const out = computeSearchableText({
      description: null,
      type: "grant",
    });
    expect(out).toBe("grant");
    expect(out).not.toContain("null");
  });

  it("omits billingType when absent", () => {
    const out = computeSearchableText({
      description: "admin grant",
      type: "grant",
    });
    expect(out).toBe("admin grant grant");
  });

  it("omits metadata.model and metadata.openalexId when absent", () => {
    expect(
      computeSearchableText({
        description: "refund",
        metadata: {},
        type: "refund",
      }),
    ).toBe("refund refund");
  });

  it("lowercases every token", () => {
    const out = computeSearchableText({
      description: "UPPER CASE",
      metadata: { model: "GPT-4", openalexId: "W999" },
      billingType: "extraction_llm",
      type: "usage",
    });
    expect(out).toBe(out.toLowerCase());
  });
});
