import { describe, expect, it } from "vitest";
import {
  createSearchParameters,
  createDefaultFilters,
} from "../lib/utils";
import type { SearchField, SearchFilters } from "../lib/types";

describe("createSearchParameters", () => {
  const baseFilters: SearchFilters = createDefaultFilters();

  describe("search field mapping", () => {
    it.each([
      ["title_and_abstract", { title_and_abstract: { search: "quantum" } }],
      ["title", { title: { search: "quantum" } }],
      ["abstract", { abstract: { search: "quantum" } }],
      ["fulltext", { fulltext: { search: "quantum" } }],
      ["display_name", { display_name: { search: "quantum" } }],
    ] as [SearchField, Record<string, { search: string }>][])(
      "maps field=%s to correct API filter",
      (field, expected) => {
        const filters: SearchFilters = {
          ...baseFilters,
          searchField: field,
        };
        const result = createSearchParameters("quantum", filters);
        expect(result.filter).toMatchObject(expected);
      }
    );
  });

  it("does not add search field filter for empty query", () => {
    const filters: SearchFilters = {
      ...baseFilters,
      yearRange: undefined,
      dateRange: undefined,
    };
    const result = createSearchParameters("", filters);
    expect(result.filter).toBeUndefined();
  });

  describe("cites filter", () => {
    it("preserves full OpenAlex URL for cites", () => {
      const filters: SearchFilters = {
        ...baseFilters,
        citesItemId: "https://openalex.org/W123",
      };
      const result = createSearchParameters("test", filters);
      expect(result.filter.cites).toBe("https://openalex.org/W123");
    });

    it("adds OpenAlex URL prefix for bare cites ID", () => {
      const filters: SearchFilters = {
        ...baseFilters,
        citesItemId: "W123",
      };
      const result = createSearchParameters("test", filters);
      expect(result.filter.cites).toBe("https://openalex.org/W123");
    });
  });

  it("adds cited_by filter with URL prefix", () => {
    const filters: SearchFilters = {
      ...baseFilters,
      citedByItemId: "W456",
    };
    const result = createSearchParameters("test", filters);
    expect(result.filter.cited_by).toBe("https://openalex.org/W456");
  });

  it("adds related_to filter with URL prefix", () => {
    const filters: SearchFilters = {
      ...baseFilters,
      relatedToItemId: "W789",
    };
    const result = createSearchParameters("test", filters);
    expect(result.filter.related_to).toBe("https://openalex.org/W789");
  });

  describe("date range filter", () => {
    it("converts dateRange to publication date boundaries", () => {
      const filters: SearchFilters = {
        ...baseFilters,
        dateRange: {
          from: new Date("2024-01-15T00:00:00Z"),
          to: new Date("2024-06-30T00:00:00Z"),
        },
      };
      const result = createSearchParameters("test", filters);
      expect(result.filter.from_publication_date).toBe("2024-01-15");
      expect(result.filter.to_publication_date).toBe("2024-06-30");
    });
  });

  describe("year range filter", () => {
    it("converts yearRange to YYYY-01-01 and YYYY-12-31 when no dateRange", () => {
      const filters: SearchFilters = {
        ...baseFilters,
        yearRange: [2020, 2024] as [number, number],
        dateRange: undefined,
      };
      const result = createSearchParameters("test", filters);
      expect(result.filter.from_publication_date).toBe("2020-01-01");
      expect(result.filter.to_publication_date).toBe("2024-12-31");
    });
  });

  it("uses dateRange over yearRange when both present", () => {
    const filters: SearchFilters = {
      ...baseFilters,
      dateRange: {
        from: new Date("2024-03-01T00:00:00Z"),
        to: new Date("2024-09-01T00:00:00Z"),
      },
      yearRange: [2020, 2024] as [number, number],
    };
    const result = createSearchParameters("test", filters);
    expect(result.filter.from_publication_date).toBe("2024-03-01");
    expect(result.filter.to_publication_date).toBe("2024-09-01");
  });

  it("builds authorships.countries from selectedRegions", () => {
    const filters: SearchFilters = {
      ...baseFilters,
      selectedRegions: ["africa"],
    };
    const result = createSearchParameters("test", filters);
    expect(result.filter.authorships).toBeDefined();
    expect(result.filter.authorships.countries).toBeDefined();
    // countries is a pipe-separated string of country codes
    expect(typeof result.filter.authorships.countries).toBe("string");
    expect(result.filter.authorships.countries.length).toBeGreaterThan(0);
  });

  describe("sort", () => {
    it("parses sortBy string into field and order", () => {
      const filters: SearchFilters = {
        ...baseFilters,
        sortBy: "cited_by_count:desc",
      };
      const result = createSearchParameters("test", filters);
      expect(result.sortBy).toEqual({
        field: "cited_by_count",
        order: "desc",
      });
    });

    it("defaults to relevance_score:desc when sortBy is empty", () => {
      const filters: SearchFilters = {
        ...baseFilters,
        sortBy: "",
      };
      const result = createSearchParameters("test", filters);
      expect(result.sortBy).toEqual({
        field: "relevance_score",
        order: "desc",
      });
    });
  });

  it("always includes perPage and AbstractArrayToString", () => {
    const result = createSearchParameters("test", baseFilters);
    expect(result.perPage).toBe(200);
    expect(result.AbstractArrayToString).toBe(true);
  });

  it("combines multiple filters correctly", () => {
    const filters: SearchFilters = {
      ...baseFilters,
      searchField: "title" as SearchField,
      citesItemId: "W100",
      yearRange: [2020, 2024] as [number, number],
    };
    const result = createSearchParameters("test", filters);
    expect(result.filter.title).toEqual({ search: "test" });
    expect(result.filter.cites).toBe("https://openalex.org/W100");
    expect(result.filter.from_publication_date).toBe("2020-01-01");
    expect(result.filter.to_publication_date).toBe("2024-12-31");
  });
});
