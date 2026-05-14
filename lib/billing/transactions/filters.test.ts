import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTER_STATE,
  buildFilterPredicate,
  isFilterActive,
  toServerFilterArgs,
  type FilterState,
} from "./filters";
import type { TransactionViewModel } from "./transaction-view-model";

function makeRow(overrides: Partial<TransactionViewModel> = {}): TransactionViewModel {
  return {
    id: "txn_1",
    type: "purchase",
    creditType: "paid",
    billingType: null,
    direction: "in",
    amount: 100,
    signedAmount: 100,
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

describe("DEFAULT_FILTER_STATE", () => {
  it("has empty arrays, null dateRange, empty search", () => {
    expect(DEFAULT_FILTER_STATE).toEqual({
      types: [],
      creditPools: [],
      billingTypes: [],
      dateRange: null,
      search: "",
    });
  });
});

describe("isFilterActive", () => {
  it("false for the default state", () => {
    expect(isFilterActive(DEFAULT_FILTER_STATE)).toBe(false);
  });

  it("true once search is non-empty", () => {
    expect(isFilterActive({ ...DEFAULT_FILTER_STATE, search: "foo" })).toBe(true);
  });

  it("true once types has any entry", () => {
    expect(
      isFilterActive({ ...DEFAULT_FILTER_STATE, types: ["purchase"] }),
    ).toBe(true);
  });

  it("true once creditPools has any entry", () => {
    expect(
      isFilterActive({ ...DEFAULT_FILTER_STATE, creditPools: ["free"] }),
    ).toBe(true);
  });

  it("true once billingTypes has any entry", () => {
    expect(
      isFilterActive({ ...DEFAULT_FILTER_STATE, billingTypes: ["screening"] }),
    ).toBe(true);
  });

  it("true once dateRange is set", () => {
    expect(
      isFilterActive({ ...DEFAULT_FILTER_STATE, dateRange: { from: 1, to: 2 } }),
    ).toBe(true);
  });

  it("whitespace-only search is NOT active", () => {
    expect(isFilterActive({ ...DEFAULT_FILTER_STATE, search: "   " })).toBe(false);
  });
});

describe("buildFilterPredicate", () => {
  it("type filter: matches a purchase, rejects a usage", () => {
    const predicate = buildFilterPredicate({
      ...DEFAULT_FILTER_STATE,
      types: ["purchase"],
    });
    expect(predicate(makeRow({ type: "purchase" }))).toBe(true);
    expect(predicate(makeRow({ type: "usage" }))).toBe(false);
  });

  it("multi-type filter: matches any included type", () => {
    const predicate = buildFilterPredicate({
      ...DEFAULT_FILTER_STATE,
      types: ["purchase", "grant"],
    });
    expect(predicate(makeRow({ type: "purchase" }))).toBe(true);
    expect(predicate(makeRow({ type: "grant" }))).toBe(true);
    expect(predicate(makeRow({ type: "usage" }))).toBe(false);
  });

  it("empty types array matches every type", () => {
    const predicate = buildFilterPredicate(DEFAULT_FILTER_STATE);
    expect(predicate(makeRow({ type: "purchase" }))).toBe(true);
    expect(predicate(makeRow({ type: "usage" }))).toBe(true);
    expect(predicate(makeRow({ type: "expiry" }))).toBe(true);
  });

  it("search matches description case-insensitively", () => {
    const predicate = buildFilterPredicate({
      ...DEFAULT_FILTER_STATE,
      search: "STRIPE",
    });
    expect(predicate(makeRow({ description: "Stripe invoice 123" }))).toBe(true);
    expect(predicate(makeRow({ description: "monthly credit grant" }))).toBe(false);
  });

  it("search on a row with null description does not match", () => {
    const predicate = buildFilterPredicate({
      ...DEFAULT_FILTER_STATE,
      search: "stripe",
    });
    expect(predicate(makeRow({ description: null }))).toBe(false);
  });

  it("creditPools narrows to the pool set", () => {
    const predicate = buildFilterPredicate({
      ...DEFAULT_FILTER_STATE,
      creditPools: ["free"],
    });
    expect(predicate(makeRow({ creditType: "free" }))).toBe(true);
    expect(predicate(makeRow({ creditType: "paid" }))).toBe(false);
  });

  it("billingTypes narrows to the billingType set", () => {
    const predicate = buildFilterPredicate({
      ...DEFAULT_FILTER_STATE,
      billingTypes: ["screening"],
    });
    expect(predicate(makeRow({ billingType: "screening" }))).toBe(true);
    expect(predicate(makeRow({ billingType: "extraction_llm" }))).toBe(false);
    expect(predicate(makeRow({ billingType: null }))).toBe(false);
  });

  it("dateRange narrows by createdAt inclusively", () => {
    const predicate = buildFilterPredicate({
      ...DEFAULT_FILTER_STATE,
      dateRange: { from: 100, to: 200 },
    });
    expect(predicate(makeRow({ createdAt: 100 }))).toBe(true);
    expect(predicate(makeRow({ createdAt: 150 }))).toBe(true);
    expect(predicate(makeRow({ createdAt: 200 }))).toBe(true);
    expect(predicate(makeRow({ createdAt: 99 }))).toBe(false);
    expect(predicate(makeRow({ createdAt: 201 }))).toBe(false);
  });

  it("composes AND across axes", () => {
    const predicate = buildFilterPredicate({
      types: ["usage"],
      creditPools: ["paid"],
      billingTypes: [],
      dateRange: null,
      search: "",
    });
    expect(
      predicate(makeRow({ type: "usage", creditType: "paid" })),
    ).toBe(true);
    expect(
      predicate(makeRow({ type: "usage", creditType: "free" })),
    ).toBe(false);
    expect(
      predicate(makeRow({ type: "purchase", creditType: "paid" })),
    ).toBe(false);
  });
});

describe("toServerFilterArgs", () => {
  it("default state → empty args object (no server-side narrowing)", () => {
    expect(toServerFilterArgs(DEFAULT_FILTER_STATE)).toEqual({});
  });

  it("projects types and dateRange onto coarse server args", () => {
    const state: FilterState = {
      types: ["purchase"],
      creditPools: [],
      billingTypes: [],
      dateRange: { from: 1, to: 2 },
      search: "",
    };
    expect(toServerFilterArgs(state)).toEqual({
      types: ["purchase"],
      from: 1,
      to: 2,
    });
  });

  it("projects creditPools, billingTypes, and search onto server args (plan-perf-02 widening)", () => {
    const state: FilterState = {
      types: [],
      creditPools: ["free"],
      billingTypes: ["screening"],
      dateRange: null,
      search: "hello",
    };
    expect(toServerFilterArgs(state)).toEqual({
      creditPools: ["free"],
      billingTypes: ["screening"],
      q: "hello",
    });
  });

  it("trims whitespace-only search to empty, omits from args", () => {
    const state: FilterState = {
      types: [],
      creditPools: [],
      billingTypes: [],
      dateRange: null,
      search: "   ",
    };
    expect(toServerFilterArgs(state)).toEqual({});
  });

  it("omits types when the array is empty", () => {
    const state: FilterState = {
      types: [],
      creditPools: [],
      billingTypes: [],
      dateRange: { from: 1, to: 2 },
      search: "",
    };
    expect(toServerFilterArgs(state)).toEqual({ from: 1, to: 2 });
  });
});
