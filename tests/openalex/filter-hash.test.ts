import { describe, it, expect } from "vitest";
import { hashSearchFilters } from "@/lib/openalex/filter-hash";

describe("hashSearchFilters", () => {
  it("returns identical hash for two entries with identical filters but different ids/timestamps", () => {
    const a = {
      query: "cancer therapy",
      field: "title_and_abstract",
      yearRange: [2020, 2024] as [number, number],
      filterType: "year",
      isYearRangeEnabled: true,
    };
    const b = { ...a };
    // SearchResult extras that must not affect the hash.
    const aPlus = {
      ...a,
      id: "sr_1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      count: 4217,
      queryHistory: [{ query: "cancer", timestamp: "2026-01-01" }],
      questionHistory: [],
      screeningQuestions: [{ id: "q1", label: "foo" }],
      screeningResponses: {},
      page: 3,
    };
    const bPlus = {
      ...b,
      id: "sr_2",
      createdAt: "2025-04-04T00:00:00Z",
      updatedAt: "2025-04-05T00:00:00Z",
      count: 9999,
      queryHistory: [],
      questionHistory: [{ question: "x", timestamp: "2025-04-04" }],
      screeningQuestions: [],
      screeningResponses: { q1: "yes" },
      page: 1,
    };
    expect(hashSearchFilters(aPlus)).toBe(hashSearchFilters(bPlus));
  });

  it("returns different hashes when yearRange differs by one year", () => {
    const base = { query: "cancer", field: "title_and_abstract" };
    const a = { ...base, yearRange: [2020, 2024] as [number, number] };
    const b = { ...base, yearRange: [2019, 2024] as [number, number] };
    expect(hashSearchFilters(a)).not.toBe(hashSearchFilters(b));
  });

  it("is independent of JavaScript key-insertion order", () => {
    const ordered = {
      query: "neural",
      field: "title",
      sortBy: "publication_date:desc",
      reviewFilter: true,
    };
    const reversed = {
      reviewFilter: true,
      sortBy: "publication_date:desc",
      field: "title",
      query: "neural",
    };
    expect(hashSearchFilters(ordered)).toBe(hashSearchFilters(reversed));
  });

  it("is independent of selectedRegions order (set-like equality)", () => {
    const a = { query: "x", selectedRegions: ["US", "UK", "FR"] };
    const b = { query: "x", selectedRegions: ["FR", "UK", "US"] };
    expect(hashSearchFilters(a)).toBe(hashSearchFilters(b));
  });

  it("is independent of selectedCountryFocus order", () => {
    const a = { query: "x", selectedCountryFocus: ["us", "gb"] };
    const b = { query: "x", selectedCountryFocus: ["gb", "us"] };
    expect(hashSearchFilters(a)).toBe(hashSearchFilters(b));
  });

  it("treats empty arrays and missing arrays as equivalent", () => {
    const a = { query: "x" };
    const b = {
      query: "x",
      selectedRegions: [],
      selectedCountryFocus: [],
    };
    expect(hashSearchFilters(a)).toBe(hashSearchFilters(b));
  });

  it("normalises dateRange Date vs ISO string to the same hash", () => {
    const iso = {
      query: "x",
      dateRange: { from: "2020-01-01", to: "2020-12-31" },
    };
    const dates = {
      query: "x",
      dateRange: {
        from: new Date("2020-01-01T00:00:00Z"),
        to: new Date("2020-12-31T00:00:00Z"),
      },
    };
    expect(hashSearchFilters(iso)).toBe(hashSearchFilters(dates));
  });

  it("screeningQuestions and queryHistory differences do not affect the hash (excluded)", () => {
    const base = { query: "x", field: "title_and_abstract" };
    const a = {
      ...base,
      screeningQuestions: [{ id: "q1", label: "L" }],
      queryHistory: [{ query: "old", timestamp: "2025-01-01" }],
    };
    const b = {
      ...base,
      screeningQuestions: [],
      queryHistory: [],
    };
    expect(hashSearchFilters(a)).toBe(hashSearchFilters(b));
  });

  it("produces a short hex string", () => {
    const h = hashSearchFilters({ query: "x" });
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.length).toBeGreaterThan(0);
    expect(h.length).toBeLessThanOrEqual(16);
  });

  it("empty input returns a stable non-empty hash (null-key branch never hits this)", () => {
    const h1 = hashSearchFilters({});
    const h2 = hashSearchFilters({});
    expect(h1).toBe(h2);
  });
});
