import { describe, expect, it } from "vitest";
import { applySearchEdit, importSearchRecord, restoreSearch, serializeSearch, type SavedSearch } from "./records";

const search: SavedSearch = {
  id: "local-search", query: "tutoring", field: "title", count: 12,
  queryHistoryCount: 0, questionCount: 0, questionText: "", screeningQuestions: [{ question: "Trial?" }],
  screeningResponses: [{ paperId: "W1", responses: [{ question: "Trial?", response: true }, { question: "Adults?", response: null }] }],
  createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z",
};

describe("saved search edits", () => {
  it("imports History CSV values and native fields without leaking export column names", () => {
    const csv = serializeSearch(importSearchRecord({ search_query: "education", count: "42", field: "title" }));
    expect(csv).toMatchObject({ query: "education", count: 42, field: "title" });
    expect(csv).not.toHaveProperty("search_query");
    const full = { ...restoreSearch(search), yearRange: [2020, 2025], page: 3 };
    expect(serializeSearch(importSearchRecord(full))).toMatchObject({ ...search, id: expect.any(String), queryHistoryCount: 1, yearRange: [2020, 2025], page: 3 });
  });
  it("clears optional filters without removing required search fields", () => {
    const result = applySearchEdit({ ...search, yearRange: [2020, 2025] }, { kind: "patch", fields: {}, clear: ["yearRange"] }, search.updatedAt);
    expect(result.yearRange).toBeUndefined();
    expect(result.query).toBe("tutoring");
    expect(() => applySearchEdit(search, { kind: "patch", fields: {}, clear: ["query"] }, search.updatedAt)).toThrow();
  });
  it("invalidates only responses to a renamed screening question", () => {
    const result = applySearchEdit(search, { kind: "replaceScreeningQuestion", question: "Trial?", replacement: "Randomized?" }, search.updatedAt);
    expect(result.screeningQuestions).toEqual([{ question: "Randomized?" }]);
    expect(restoreSearch(result).screeningResponses).toEqual({ W1: { "Adults?": null } });
  });
  it("round trips date ranges and full filter state", () => {
    const input = { ...search, dateRange: { from: "2020-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" }, yearRange: [2020, 2025], includeRetracted: true, ratingRange: [1, 5], chatJobIdsByAccountId: { userA: "jobA" } };
    expect(restoreSearch(input).dateRange?.from).toBeInstanceOf(Date);
    expect(serializeSearch(restoreSearch(input))).toEqual(input);
  });
});
