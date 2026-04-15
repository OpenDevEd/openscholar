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
  migrateBasketState,
  basketStorage,
  type BasketEntry,
} from "../lib/store/extraction-basket";

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

describe("useExtractionBasketStore", () => {
  beforeEach(() => {
    useExtractionBasketStore.setState({ papers: new Map() });
  });

  it("add(entry) inserts a new entry", () => {
    const entry = makeEntry();
    useExtractionBasketStore.getState().add(entry);
    expect(useExtractionBasketStore.getState().papers.size).toBe(1);
  });

  it("add(entry) with duplicate openAlexId is a no-op", () => {
    const entry = makeEntry();
    useExtractionBasketStore.getState().add(entry);
    useExtractionBasketStore.getState().add(
      makeEntry({ title: "Duplicate Attempt" }),
    );
    expect(useExtractionBasketStore.getState().papers.size).toBe(1);
    expect(useExtractionBasketStore.getState().papers.get("W111111111")?.title).toBe(
      "Test Paper",
    );
  });

  it("add([entry1, entry2, entry3]) batch-adds 3 entries", () => {
    const entries = [
      makeEntry({ openAlexId: "W100" }),
      makeEntry({ openAlexId: "W200" }),
      makeEntry({ openAlexId: "W300" }),
    ];
    useExtractionBasketStore.getState().add(entries);
    expect(useExtractionBasketStore.getState().papers.size).toBe(3);
  });

  it("add([entry1, entry1duplicate]) batch-adds only 1 entry", () => {
    const entries = [
      makeEntry({ openAlexId: "W100" }),
      makeEntry({ openAlexId: "W100", title: "Duplicate" }),
    ];
    useExtractionBasketStore.getState().add(entries);
    expect(useExtractionBasketStore.getState().papers.size).toBe(1);
  });

  it("remove(id) deletes the entry", () => {
    const entry = makeEntry();
    useExtractionBasketStore.getState().add(entry);
    useExtractionBasketStore.getState().remove("W111111111");
    expect(useExtractionBasketStore.getState().papers.size).toBe(0);
  });

  it("remove(nonExistentId) is a no-op", () => {
    expect(() => {
      useExtractionBasketStore.getState().remove("W999999999");
    }).not.toThrow();
  });

  it("has(existingId) returns true", () => {
    const entry = makeEntry();
    useExtractionBasketStore.getState().add(entry);
    expect(useExtractionBasketStore.getState().has("W111111111")).toBe(true);
  });

  it("has(nonExistentId) returns false", () => {
    expect(useExtractionBasketStore.getState().has("W999999999")).toBe(false);
  });

  it("clear() empties the Map", () => {
    useExtractionBasketStore.getState().add(makeEntry());
    useExtractionBasketStore.getState().clear();
    expect(useExtractionBasketStore.getState().papers.size).toBe(0);
  });
});

describe("migrateBasketState", () => {
  it("version 0 returns fresh state with empty Map", () => {
    const result = migrateBasketState({ papers: "garbage" }, 0);
    expect(result).toEqual({ papers: new Map() });
  });

  it("version 1 passes through state unchanged", () => {
    const state = { papers: new Map([["W1", makeEntry()]]) };
    const result = migrateBasketState(state, 1);
    expect(result).toBe(state);
  });
});

describe("basketStorage", () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    });
  });

  it("setItem serializes Map to [key, value][] array", () => {
    const entry = makeEntry({ openAlexId: "W42" });
    const papers = new Map([["W42", entry]]);
    basketStorage.setItem("test-key", {
      state: { papers },
      version: 1,
    });
    const raw = JSON.parse(storage["test-key"]);
    expect(Array.isArray(raw.state.papers)).toBe(true);
    expect(raw.state.papers[0][0]).toBe("W42");
  });

  it("getItem deserializes [key, value][] array back to Map", () => {
    const entry = makeEntry({ openAlexId: "W42" });
    storage["test-key"] = JSON.stringify({
      state: { papers: [["W42", entry]] },
      version: 1,
    });
    const result = basketStorage.getItem("test-key");
    expect(result?.state.papers).toBeInstanceOf(Map);
    expect(result?.state.papers.get("W42")?.openAlexId).toBe("W42");
  });
});

describe("entriesBySource grouping", () => {
  beforeEach(() => {
    useExtractionBasketStore.setState({ papers: new Map() });
  });

  it("groups entries correctly by source field", () => {
    const entries = [
      makeEntry({ openAlexId: "W1", source: "library" }),
      makeEntry({ openAlexId: "W2", source: "search" }),
      makeEntry({ openAlexId: "W3", source: "library" }),
      makeEntry({ openAlexId: "W4", source: "manual" }),
    ];
    useExtractionBasketStore.getState().add(entries);
    const papers = useExtractionBasketStore.getState().papers;
    const grouped = new Map<string, BasketEntry[]>();
    for (const entry of papers.values()) {
      const existing = grouped.get(entry.source) ?? [];
      existing.push(entry);
      grouped.set(entry.source, existing);
    }
    expect(grouped.get("library")?.length).toBe(2);
    expect(grouped.get("search")?.length).toBe(1);
    expect(grouped.get("manual")?.length).toBe(1);
  });
});
