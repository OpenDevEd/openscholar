import { describe, it, expect } from "vitest";
import { migrateSearchHistoryState } from "../lib/store";

describe("migrateSearchHistoryState (collapsed)", () => {
  it("version 0 returns fresh default state", () => {
    const result = migrateSearchHistoryState({ searchHistory: [{ query: "old" }] }, 0);
    expect(result).toEqual({ searchHistory: [] });
  });

  it("version < 1 returns fresh default state regardless of input shape", () => {
    const result = migrateSearchHistoryState("garbage", 0);
    expect(result).toEqual({ searchHistory: [] });
  });

  it("version 1 passes through state unchanged", () => {
    const state = { searchHistory: [{ query: "test", createdAt: "2026-01-01" }] };
    const result = migrateSearchHistoryState(state, 1);
    expect(result).toBe(state); // Same reference -- passthrough
  });

  it("version > 1 passes through state unchanged", () => {
    const state = { searchHistory: [] };
    const result = migrateSearchHistoryState(state, 5);
    expect(result).toBe(state);
  });
});
