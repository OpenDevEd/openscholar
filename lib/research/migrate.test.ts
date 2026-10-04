// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { importLocalResearch } from "./migrate";
import { localKeywordExpansionStore, localRatingsStore, localSearchHistoryStore, useAIConfigStore, useUIStore } from "../store";

beforeEach(() => {
  localStorage.clear();
  localSearchHistoryStore.setState({ searchHistory: [] });
  localKeywordExpansionStore.setState({ keywords: {} });
  localRatingsStore.setState({ ratings: {} });
});

function seed() {
  const id = localSearchHistoryStore.getState().addSearchResult({ query: "education", field: "title", count: 12, researchAreas: ["17"], includeRetracted: true, page: 4 });
  localSearchHistoryStore.getState().setScreeningResponse(id, "W1", "Randomized?", true);
  localKeywordExpansionStore.getState().addKeyword("rct", "randomized controlled trial");
  localRatingsStore.getState().setRating("W1", 5);
  return id;
}

describe("local research import acknowledgement", () => {
  it("keeps invalid older records while migrating valid records and their screening answers", async () => {
    const id = seed();
    const original = localSearchHistoryStore.getState().getSearchResult(id)!;
    const invalid = { ...original, id: "", count: -1 };
    localSearchHistoryStore.setState({ searchHistory: [{ ...original, id: "" }, invalid] });
    const saved: unknown[] = [];
    const failures = await importLocalResearch("alice", async batch => { saved.push(...batch.searches); return null; }, () => true);
    expect(failures).toHaveLength(1);
    expect(saved).toMatchObject([{ search: { id: expect.any(String), screeningResponses: [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }] } }]);
    expect(localSearchHistoryStore.getState().searchHistory).toEqual([invalid]);
    expect(localRatingsStore.getState().ratings).toEqual({});
  });
  it("keeps a rejected record while importing unrelated valid records", async () => {
    const id = seed();
    const errors = await importLocalResearch("alice", async batch => {
      if (batch.shortcuts.length) throw new Error("Conflicting bookmark");
      return null;
    }, () => true);
    expect(errors).toHaveLength(1);
    expect(localSearchHistoryStore.getState().getSearchResult(id)).toBeUndefined();
    expect(localRatingsStore.getState().ratings).toEqual({});
    expect(localKeywordExpansionStore.getState().keywords.rct.expansion).toBe("randomized controlled trial");
  });

  it("does not overwrite data added by another browser tab during acknowledgement", async () => {
    seed();
    await importLocalResearch("alice", async () => {
      const saved = JSON.parse(localStorage.getItem("paper-ratings-store")!);
      saved.state.ratings.W2 = 3;
      localStorage.setItem("paper-ratings-store", JSON.stringify(saved));
      return null;
    }, () => true);
    expect(localRatingsStore.getState().ratings).toEqual({ W2: 3 });
  });
  it("retains local records until the server acknowledges the whole batch", async () => {
    const id = seed();
    let acknowledge!: (value: null) => void;
    const request = new Promise<null>(resolve => { acknowledge = resolve; });
    const promise = importLocalResearch("alice", async batch => {
      expect(batch.searches[0].search).toMatchObject({ id, researchAreas: ["17"], includeRetracted: true, page: 4, screeningResponses: [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }] });
      return request;
    }, () => true);
    expect(localSearchHistoryStore.getState().getSearchResult(id)?.count).toBe(12);
    expect(localKeywordExpansionStore.getState().keywords.rct.expansion).toBe("randomized controlled trial");
    expect(localRatingsStore.getState().ratings.W1).toBe(5);
    acknowledge(null); await promise;
    expect(localSearchHistoryStore.getState().searchHistory).toEqual([]);
    expect(localKeywordExpansionStore.getState().keywords).toEqual({});
    expect(localRatingsStore.getState().ratings).toEqual({});
  });

  it("retries a failed import with the same IDs and keeps settings and API keys local", async () => {
    const id = seed();
    useAIConfigStore.getState().setApiKey("test-user-owned-key");
    useUIStore.getState().setHistoryViewMode("grid-2");
    const keyBefore = localStorage.getItem("ai-config-store");
    const settingsBefore = localStorage.getItem("ui-store");
    expect(await importLocalResearch("alice", async () => { throw new Error("Offline"); }, () => true)).toHaveLength(3);
    expect(localSearchHistoryStore.getState().getSearchResult(id)?.query).toBe("education");
    await importLocalResearch("alice", async batch => {
      expect(batch.searches.map(row => row.search.id)).toEqual([id]);
      expect(JSON.stringify(batch)).not.toContain("test-user-owned-key");
      return null;
    }, () => true);
    expect(localStorage.getItem("ai-config-store")).toBe(keyBefore);
    expect(localStorage.getItem("ui-store")).toBe(settingsBefore);
  });

  it("does not import another account's interrupted records after switching users", async () => {
    const id = seed();
    expect(await importLocalResearch("alice", async () => { throw new Error("Offline"); }, () => true)).toHaveLength(3);
    const bobBatches: unknown[] = [];
    await importLocalResearch("bob", async batch => { bobBatches.push(batch); return null; }, () => true);
    expect(bobBatches).toEqual([]);
    expect(localSearchHistoryStore.getState().getSearchResult(id)?.query).toBe("education");
    await importLocalResearch("alice", async () => null, () => true);
    expect(localSearchHistoryStore.getState().searchHistory).toEqual([]);
    const freshId = seed();
    await importLocalResearch("bob", async batch => { expect(batch.searches[0].search.id).toBe(freshId); return null; }, () => true);
    expect(localSearchHistoryStore.getState().searchHistory).toEqual([]);
  });

  it("does not clear an edit made while the import was in flight", async () => {
    const id = seed();
    await importLocalResearch("alice", async () => {
      localSearchHistoryStore.getState().updateSearchResult(id, { query: "edited while offline" });
      return null;
    }, () => true);
    expect(localSearchHistoryStore.getState().getSearchResult(id)?.query).toBe("edited while offline");
  });

  it("imports large histories in bounded batches without truncating them", async () => {
    for (let i = 0; i < 61; i++) localSearchHistoryStore.getState().addSearchResult({ query: `search ${i}`, field: "title", count: i });
    const ids: string[] = [];
    const sizes: number[] = [];
    await importLocalResearch("alice", async batch => {
      sizes.push(batch.searches.length + batch.shortcuts.length + batch.ratings.length);
      ids.push(...batch.searches.map(row => row.search.id));
      return null;
    }, () => true);
    expect(sizes).toEqual([25, 25, 11]);
    expect(new Set(ids).size).toBe(61);
    expect(localSearchHistoryStore.getState().searchHistory).toEqual([]);
  });
});
