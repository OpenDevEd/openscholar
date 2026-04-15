import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { migrateSearchHistoryState } from "../../lib/store";

// Test the exported migrate function directly
// Other stores' migrate functions are inline in persist configs,
// so we test the pattern via migrateSearchHistoryState (the only exported one)
// and verify all stores have version: 1 via grep

describe("store malformed localStorage resilience (CRASH-07)", () => {
  const MALFORMED_INPUTS = [
    undefined,
    null,
    "",
    "garbage string",
    42,
    { completely: "wrong shape" },
    { searchHistory: "not an array" },
    { searchHistory: [null, undefined, 42] },
  ];

  it.each(MALFORMED_INPUTS)(
    "migrateSearchHistoryState handles malformed input: %j",
    (input) => {
      // Should not throw -- returns fresh defaults for version 0
      expect(() => migrateSearchHistoryState(input, 0)).not.toThrow();
      const result = migrateSearchHistoryState(input, 0);
      expect(result).toEqual({ searchHistory: [] });
    }
  );

  it("all persisted stores in lib/store.ts have version: 1", () => {
    // Count stores with persist( and verify each has version: 1
    const persistCount = execSync(
      'grep -c "persist(" lib/store.ts || true',
      { encoding: "utf-8" }
    ).trim();
    const versionCount = execSync(
      'grep -c "version: 1" lib/store.ts || true',
      { encoding: "utf-8" }
    ).trim();
    // Every persist() call should have a corresponding version: 1
    expect(parseInt(versionCount)).toBeGreaterThanOrEqual(parseInt(persistCount));
  });
});
