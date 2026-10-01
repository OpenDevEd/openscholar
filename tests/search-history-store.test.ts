// @vitest-environment jsdom
// A signed-out visitor's searches keep their history in this browser (#354).
import { beforeEach, describe, expect, it } from "vitest";
import { localSearchHistoryStore } from "@/lib/store";

beforeEach(() => {
  localStorage.clear();
  localSearchHistoryStore.setState({ searchHistory: [] });
});

describe("local search history", () => {
  it("removes exactly the chosen entry when two share a query and time, and counts what's left", () => {
    const store = localSearchHistoryStore.getState();
    const id = store.addSearchResult({ query: "tutoring", field: "title", count: 1 });
    const timestamp = "2026-09-01T00:00:00.000Z";
    localSearchHistoryStore.setState((state) => ({
      searchHistory: state.searchHistory.map((item) => ({ ...item, queryHistory: [{ query: "tutoring", field: "title", timestamp }, { query: "tutoring", field: "abstract", timestamp }], queryHistoryCount: 2 })),
    }));
    store.removeQueryHistoryEntry(id, { query: "tutoring", field: "abstract", timestamp });
    expect(localSearchHistoryStore.getState().getSearchResult(id)).toMatchObject({ queryHistory: [{ query: "tutoring", field: "title", timestamp }], queryHistoryCount: 1 });
  });
});
