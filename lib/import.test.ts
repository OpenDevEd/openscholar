import { describe, expect, it } from "vitest";
import { parseImportFile } from "./import";
import { exportFiles, historyRow } from "./export";
import { importSearchRecord, serializeSearch, type SavedSearch } from "./research/records";
import { buildResultsUrl } from "./search-params";
import { getEffectiveSearchId } from "./utils";

describe("research file parsing", () => {
  it("uses the default search field when a versioned import omits it", () => {
    expect(importSearchRecord({ format_version: 1, export_id: "missing-field", search_query: "reading", spec: { query: "reading" } })).toMatchObject({ id: "import:missing-field", field: "title_and_abstract", count: 0 });
    for (const field of [undefined, ""]) expect(importSearchRecord({ format_version: 1, export_id: "nested-field", search_query: "reading", field, spec: { query: "reading", field: "title", count: 7 } })).toMatchObject({ field: "title", count: 7 });
  });
  it("opens imported IDs with reserved characters without looking up a different search", () => {
    const imported = importSearchRecord({ id: "بحث:100%/study", query: "reading" });
    const url = new URL(buildResultsUrl(imported.id, { q: imported.query }), "https://example.test");
    expect(getEffectiveSearchId(url.pathname)).toBe("import:بحث:100%/study");
    expect(getEffectiveSearchId("/results/import%253Atest")).toBe("import%3Atest");
    expect(getEffectiveSearchId("/results/%broken")).toBeUndefined();
  });
  it("preserves quoted Boolean text, commas, newlines, Unicode and numeric-looking text", () => {
    expect(parseImportFile('\ufeffsearch_query,count,field\r\n"""reading, writing"" AND\nتعليم",0,title\r\n0012,2,title\r\n', "csv")).toEqual([
      { search_query: '"reading, writing" AND\nتعليم', count: "0", field: "title" },
      { search_query: "0012", count: "2", field: "title" },
    ]);
  });
  it("rejects malformed CSV and unsupported search export versions without partial rows", () => {
    expect(() => parseImportFile('query,count\n"unclosed,3', "csv")).toThrow();
    expect(() => parseImportFile('query,count\nx,3,extra', "csv")).toThrow();
    expect(() => parseImportFile('{"format":"openscholar.searches","version":99,"searches":[]}', "json")).toThrow(/version/);
    expect(() => parseImportFile('[null,1]', "json")).toThrow();
    expect(() => parseImportFile('query,query\nx,y', "csv")).toThrow(/unique/);
    expect(() => importSearchRecord({ format_version: "2", search_query: "reading", field: "title", count: "1" })).toThrow(/version/);
    expect(() => importSearchRecord({ query: "reading", authors: Array.from({ length: 101 }, (_, i) => `A${i}`) })).toThrow(/limit/);
  });
  it("retains citation-only searches and distinct records received from another researcher", () => {
    const original = { id: "abc", query: "", field: "title" as const, count: 0, citesItemId: "W1" };
    const received = { ...original, id: "import:abc", relatedToItemId: "W2", importSource: { id: "abc", query: "", resolvedQuery: "", resolution: "at_export" as const } };
    const rows = [original, received].map(historyRow).map(row => importSearchRecord(row));
    expect(rows.map(row => row.id)).toEqual(["import:abc", "import:import:abc"]);
    expect(rows[0]).toMatchObject({ query: "", count: 0, citesItemId: "W1" });
    expect(rows[1]).toMatchObject({ relatedToItemId: "W2" });
  });
  it("round-trips all execution filters in actual CSV and JSON bytes", () => {
    const search: SavedSearch = {
      id: "roundtrip", query: '"reading, writing" AND\nتعليم', field: "title_and_abstract", count: 0,
      createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-02T12:00:00.000Z",
      queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [{ question: "Trial?" }], screeningResponses: [],
      dateRange: { from: "2020-01-01", to: "2025-12-31" }, yearRange: [2020, 2025], filterType: "date", isYearRangeEnabled: true,
      sortBy: "cited_by_count:desc", selectedRegions: ["africa"], selectedCountryFocus: ["MA"], ratingRange: [2, 5], onlyRatedPapers: true,
      citesItemId: "W10", citedByItemId: "W11", relatedToItemId: "W12", reviewFilter: true, researchAreas: ["17"], sdgs: ["4"],
      openAccessOnly: true, workTypes: ["article"], workLanguages: ["en"], institutionTypes: ["education"], funders: ["F123"], authors: ["A123"],
      minCitations: 0, hasAbstract: true, includeRetracted: false, language: "fr", page: 3,
    };
    for (const format of ["csv", "json"] as const) {
      const file = exportFiles.history[format];
      const bytes = file.start(new Date()) + [search].map(file.item).join("") + file.end();
      const imported = importSearchRecord(parseImportFile(bytes, format)[0]);
      expect(imported.dateRange?.from).toBeInstanceOf(Date);
      expect(serializeSearch(imported)).toMatchObject({ ...search, id: "import:roundtrip", importSource: { id: "roundtrip", query: search.query, resolvedQuery: search.query, resolution: "at_export" } });
    }
  });
});
