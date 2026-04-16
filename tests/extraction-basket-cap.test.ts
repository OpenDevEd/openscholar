import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock sessionStorage before store import (node environment has no sessionStorage)
const sessionStore: Record<string, string> = {};
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => sessionStore[key] ?? null,
  setItem: (key: string, value: string) => {
    sessionStore[key] = value;
  },
  removeItem: (key: string) => {
    delete sessionStore[key];
  },
});

import {
  useExtractionBasketStore,
  type BasketEntry,
} from "../lib/store/extraction-basket";
import {
  computeCapAwareBatch,
  type AddToBasketInput,
} from "../lib/hooks/use-add-to-basket";

function makeEntry(overrides: Partial<BasketEntry> = {}): BasketEntry {
  return {
    openAlexId: "W111111111",
    title: "Test Paper",
    doi: "10.1234/test",
    source: "search",
    addedAt: Date.now(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<AddToBasketInput> = {}): AddToBasketInput {
  return {
    rawId: "W111111111",
    title: "Test Paper",
    doi: "10.1234/test",
    source: "search",
    ...overrides,
  };
}

describe("computeCapAwareBatch", () => {
  beforeEach(() => {
    useExtractionBasketStore.setState({ papers: new Map() });
  });

  it("truncates batch when adding 5 entries with 998 of 1000 cap", () => {
    // Pre-fill 998 entries
    const prefilled = new Map<string, BasketEntry>();
    for (let i = 0; i < 998; i++) {
      const id = `W${String(i).padStart(9, "0")}`;
      prefilled.set(id, makeEntry({ openAlexId: id, title: `Paper ${i}` }));
    }
    useExtractionBasketStore.setState({ papers: prefilled });

    const inputs = [
      makeInput({ rawId: "W900000001" }),
      makeInput({ rawId: "W900000002" }),
      makeInput({ rawId: "W900000003" }),
      makeInput({ rawId: "W900000004" }),
      makeInput({ rawId: "W900000005" }),
    ];

    const result = computeCapAwareBatch(inputs, 1000);
    expect(result.added).toBe(2);
    expect(result.dropped).toBe(3);
    expect(result.entries).toHaveLength(2);
  });

  it("adds all entries when basket is empty", () => {
    const inputs = [
      makeInput({ rawId: "W100000001" }),
      makeInput({ rawId: "W100000002" }),
      makeInput({ rawId: "W100000003" }),
    ];

    const result = computeCapAwareBatch(inputs, 1000);
    expect(result.added).toBe(3);
    expect(result.dropped).toBe(0);
    expect(result.entries).toHaveLength(3);
  });

  it("rejects all entries when basket is full", () => {
    // Pre-fill to exactly 1000
    const prefilled = new Map<string, BasketEntry>();
    for (let i = 0; i < 1000; i++) {
      const id = `W${String(i).padStart(9, "0")}`;
      prefilled.set(id, makeEntry({ openAlexId: id, title: `Paper ${i}` }));
    }
    useExtractionBasketStore.setState({ papers: prefilled });

    const result = computeCapAwareBatch(
      [makeInput({ rawId: "W999999999" })],
      1000,
    );
    expect(result.added).toBe(0);
    expect(result.dropped).toBe(1);
    expect(result.entries).toHaveLength(0);
  });

  it("deduplicates entries already in basket without counting them as dropped", () => {
    // Pre-fill with 2 entries
    const prefilled = new Map<string, BasketEntry>();
    prefilled.set("W100000001", makeEntry({ openAlexId: "W100000001" }));
    prefilled.set("W100000002", makeEntry({ openAlexId: "W100000002" }));
    useExtractionBasketStore.setState({ papers: prefilled });

    const inputs = [
      makeInput({ rawId: "W100000001" }), // duplicate -- already in basket
      makeInput({ rawId: "W100000003" }), // new
      makeInput({ rawId: "W100000004" }), // new
    ];

    const result = computeCapAwareBatch(inputs, 1000);
    // W100000001 is skipped (duplicate), not counted as dropped
    expect(result.added).toBe(2);
    expect(result.dropped).toBe(0);
    expect(result.entries).toHaveLength(2);
  });

  it("filters out invalid IDs without counting them as dropped", () => {
    const inputs = [
      makeInput({ rawId: "not-a-valid-id" }), // invalid -- normalizeOpenAlexId returns null
      makeInput({ rawId: "" }), // invalid -- empty
      makeInput({ rawId: "W100000001" }), // valid
    ];

    const result = computeCapAwareBatch(inputs, 1000);
    // Invalid IDs are filtered silently -- not counted in dropped
    expect(result.added).toBe(1);
    expect(result.dropped).toBe(0);
    expect(result.entries).toHaveLength(1);
  });
});
