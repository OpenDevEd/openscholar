import { describe, expect, it } from "vitest";
import { calendarDay, restoreSearch, serializeSearch } from "@/lib/research/records";
import { expandShortcuts } from "@/lib/query-shortcuts";
import type { SearchResult } from "@/lib/types/search.types";

describe("a saved search's picked days", () => {
  it("are calendar days, so the server and every timezone read the same day", () => {
    // 1 January picked in Casablanca (UTC+1) and in New York (UTC-5), saved before 2026-10-02.
    expect(calendarDay("2024-12-31T23:00:00.000Z")).toBe("2025-01-01");
    expect(calendarDay("2025-01-01T05:00:00.000Z")).toBe("2025-01-01");
    expect(calendarDay("2025-01-31")).toBe("2025-01-31");
  });

  it("survive saving and restoring as the days picked", () => {
    const picked = { from: new Date(2025, 0, 1), to: new Date(2025, 0, 31) };
    const saved = serializeSearch({ id: "s", query: "q", field: "title_and_abstract", count: 0, createdAt: "x", updatedAt: "x", screeningQuestions: [], screeningResponses: {}, dateRange: picked } as unknown as SearchResult);
    expect(saved.dateRange).toEqual({ from: "2025-01-01", to: "2025-01-31" });
    const restored = restoreSearch(saved).dateRange!;
    expect([restored.from!.getFullYear(), restored.from!.getMonth(), restored.from!.getDate()]).toEqual([2025, 0, 1]);
    expect([restored.to!.getFullYear(), restored.to!.getMonth(), restored.to!.getDate()]).toEqual([2025, 0, 31]);
  });
});

describe("query shortcuts", () => {
  it("expand only names the person saved, not the object's own properties", () => {
    expect(expandShortcuts("constructor...", {})).toEqual({ expandedQuery: "constructor...", warnings: [{ key: "bookmarkNotFound", params: { keyword: "constructor" } }] });
    expect(expandShortcuts("rct... AND x", { rct: "randomized controlled trial" }).expandedQuery).toBe("randomized controlled trial AND x");
  });
});
