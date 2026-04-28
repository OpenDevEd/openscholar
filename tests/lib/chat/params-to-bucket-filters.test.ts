import { describe, expect, it } from "vitest";
import type { SearchParams } from "@/lib/search/types";
import { paramsToBucketSearchFilters } from "@/lib/chat/params-to-bucket-filters";

function defaultParams(overrides: Partial<SearchParams> = {}): SearchParams {
  return {
    q: "",
    field: "title_and_abstract",
    sort: "relevance_score:desc",
    page: 1,
    yf: null,
    yt: null,
    df: null,
    dt: null,
    ft: "year",
    rmin: 0,
    rmax: 5,
    rated: false,
    reg: [],
    focus: [],
    cites: "",
    citedBy: "",
    rel: "",
    review: false,
    lang: null,
    ...overrides,
  };
}

function assertNoNulls(obj: Record<string, unknown>) {
  for (const [key, value] of Object.entries(obj)) {
    expect(value, `field "${key}" is null`).not.toBeNull();
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      assertNoNulls(value as Record<string, unknown>);
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        expect(value[i], `array "${key}[${i}]" is null`).not.toBeNull();
      }
    }
  }
}

describe("paramsToBucketSearchFilters", () => {
  describe("year range", () => {
    it("omits yearRange when both yf and yt are null", () => {
      const out = paramsToBucketSearchFilters(defaultParams());
      expect(out.yearRange).toBeUndefined();
      expect(out.isYearRangeEnabled).toBe(false);
    });

    it("omits yearRange when only yf is set", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ yf: 2020, yt: null }),
      );
      expect(out.yearRange).toBeUndefined();
    });

    it("omits yearRange when only yt is set", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ yf: null, yt: 2024 }),
      );
      expect(out.yearRange).toBeUndefined();
    });

    it("includes yearRange and flag when both are set", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ yf: 2020, yt: 2024 }),
      );
      expect(out.yearRange).toEqual([2020, 2024]);
      expect(out.isYearRangeEnabled).toBe(true);
    });

    it("never emits null inside yearRange", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ yf: 2020, yt: 2024 }),
      );
      assertNoNulls(out as unknown as Record<string, unknown>);
    });
  });

  describe("date range", () => {
    it("omits dateRange when both df and dt are null", () => {
      const out = paramsToBucketSearchFilters(defaultParams());
      expect(out.dateRange).toBeUndefined();
    });

    it("includes dateRange when only df is set", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ df: "2024-01-01" }),
      );
      expect(out.dateRange).toEqual({ from: "2024-01-01", to: undefined });
    });

    it("includes dateRange when only dt is set", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ dt: "2024-12-31" }),
      );
      expect(out.dateRange).toEqual({ from: undefined, to: "2024-12-31" });
    });

    it("includes dateRange when both df and dt are set", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ df: "2024-01-01", dt: "2024-12-31" }),
      );
      expect(out.dateRange).toEqual({
        from: "2024-01-01",
        to: "2024-12-31",
      });
    });

    it("never emits null inside dateRange", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ df: null, dt: "2024-12-31" }),
      );
      // Check that no null values exist; undefined is fine
      if (out.dateRange) {
        expect(out.dateRange.from).not.toBeNull();
        expect(out.dateRange.to).not.toBeNull();
      }
    });
  });

  describe("rating range", () => {
    it("always includes ratingRange with the params values", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ rmin: 2, rmax: 4 }),
      );
      expect(out.ratingRange).toEqual([2, 4]);
    });

    it("includes ratingRange even at default 0..5", () => {
      const out = paramsToBucketSearchFilters(defaultParams());
      expect(out.ratingRange).toEqual([0, 5]);
    });

    it("includes onlyRatedPapers from rated flag", () => {
      expect(
        paramsToBucketSearchFilters(defaultParams({ rated: true }))
          .onlyRatedPapers,
      ).toBe(true);
      expect(
        paramsToBucketSearchFilters(defaultParams({ rated: false }))
          .onlyRatedPapers,
      ).toBe(false);
    });
  });

  describe("query and field", () => {
    it("omits query when empty", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ q: "" }));
      expect(out.query).toBeUndefined();
    });

    it("includes query when populated", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ q: "mindfulness" }),
      );
      expect(out.query).toBe("mindfulness");
    });

    it("mirrors field into searchField", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ field: "title" }),
      );
      expect(out.field).toBe("title");
      expect(out.searchField).toBe("title");
    });

    it("includes filterType from ft", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ ft: "date" }));
      expect(out.filterType).toBe("date");
    });

    it("includes sortBy from sort", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ sort: "cited_by_count:desc" }),
      );
      expect(out.sortBy).toBe("cited_by_count:desc");
    });
  });

  describe("regions and country focus", () => {
    it("omits selectedRegions when reg is empty", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ reg: [] }));
      expect(out.selectedRegions).toBeUndefined();
    });

    it("includes selectedRegions when reg has values", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ reg: ["Q1", "Q2"] }),
      );
      expect(out.selectedRegions).toEqual(["Q1", "Q2"]);
    });

    it("omits selectedCountryFocus when focus is empty", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ focus: [] }));
      expect(out.selectedCountryFocus).toBeUndefined();
    });

    it("includes selectedCountryFocus when focus has values", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ focus: ["US", "DE"] }),
      );
      expect(out.selectedCountryFocus).toEqual(["US", "DE"]);
    });
  });

  describe("reference filters", () => {
    it("omits citesItemId when empty string", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ cites: "" }));
      expect(out.citesItemId).toBeUndefined();
    });

    it("includes citesItemId when populated", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ cites: "W123" }),
      );
      expect(out.citesItemId).toBe("W123");
    });

    it("omits citedByItemId when empty string", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ citedBy: "" }));
      expect(out.citedByItemId).toBeUndefined();
    });

    it("includes citedByItemId when populated", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ citedBy: "W456" }),
      );
      expect(out.citedByItemId).toBe("W456");
    });

    it("omits relatedToItemId when empty string", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ rel: "" }));
      expect(out.relatedToItemId).toBeUndefined();
    });

    it("includes relatedToItemId when populated", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ rel: "W789" }));
      expect(out.relatedToItemId).toBe("W789");
    });
  });

  describe("review and language", () => {
    it("includes reviewFilter from review flag", () => {
      expect(
        paramsToBucketSearchFilters(defaultParams({ review: true }))
          .reviewFilter,
      ).toBe(true);
      expect(
        paramsToBucketSearchFilters(defaultParams({ review: false }))
          .reviewFilter,
      ).toBe(false);
    });

    it("omits language when null", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ lang: null }));
      expect(out.language).toBeUndefined();
    });

    it("omits language when empty string", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ lang: "" }));
      expect(out.language).toBeUndefined();
    });

    it("includes language when populated", () => {
      const out = paramsToBucketSearchFilters(defaultParams({ lang: "en" }));
      expect(out.language).toBe("en");
    });
  });

  describe("null safety", () => {
    it("never emits null for any field, given a defaults-only params", () => {
      const out = paramsToBucketSearchFilters(defaultParams());
      assertNoNulls(out as unknown as Record<string, unknown>);
    });

    it("never emits null when every nullable field is null", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({
          yf: null,
          yt: null,
          df: null,
          dt: null,
          lang: null,
        }),
      );
      assertNoNulls(out as unknown as Record<string, unknown>);
    });

    it("never emits null with a fully-populated input", () => {
      const out = paramsToBucketSearchFilters({
        q: "anxiety",
        field: "title",
        sort: "cited_by_count:desc",
        page: 3,
        yf: 2018,
        yt: 2024,
        df: "2018-01-01",
        dt: "2024-12-31",
        ft: "year",
        rmin: 1,
        rmax: 4,
        rated: true,
        reg: ["Q1"],
        focus: ["US"],
        cites: "W1",
        citedBy: "W2",
        rel: "W3",
        review: true,
        lang: "en",
      });
      assertNoNulls(out as unknown as Record<string, unknown>);
    });
  });

  describe("validator-shape compatibility (regression for the null bug)", () => {
    it("does not produce yearRange[0]=null when yf is null", () => {
      const out = paramsToBucketSearchFilters(
        defaultParams({ yf: null, yt: null }),
      );
      // The original bug: yearRange = [null, null] reached the server.
      expect(out.yearRange).toBeUndefined();
    });

    it("does not produce yearRange when only one of yf/yt is set", () => {
      // Both must be present for a valid year range; the validator wants
      // [number, number], not [number, undefined] or [undefined, number].
      expect(
        paramsToBucketSearchFilters(defaultParams({ yf: 2020, yt: null }))
          .yearRange,
      ).toBeUndefined();
      expect(
        paramsToBucketSearchFilters(defaultParams({ yf: null, yt: 2024 }))
          .yearRange,
      ).toBeUndefined();
    });

    it("returns only fields the searchFiltersValidator accepts", () => {
      const allowed = new Set([
        "query",
        "field",
        "searchField",
        "sortBy",
        "yearRange",
        "dateRange",
        "selectedRegions",
        "selectedCountryFocus",
        "reviewFilter",
        "citesItemId",
        "citedByItemId",
        "relatedToItemId",
        "isYearRangeEnabled",
        "filterType",
        "ratingRange",
        "onlyRatedPapers",
        "language",
        "perPage",
        "limit",
      ]);
      const out = paramsToBucketSearchFilters({
        q: "x",
        field: "title",
        sort: "s",
        page: 1,
        yf: 2020,
        yt: 2024,
        df: "2020-01-01",
        dt: "2024-12-31",
        ft: "year",
        rmin: 0,
        rmax: 5,
        rated: false,
        reg: ["Q1"],
        focus: ["US"],
        cites: "W1",
        citedBy: "W2",
        rel: "W3",
        review: false,
        lang: "en",
      });
      for (const key of Object.keys(out)) {
        expect(allowed, `unknown key "${key}" leaked to validator`).toContain(
          key,
        );
      }
    });
  });
});
