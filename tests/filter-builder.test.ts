import { describe, expect, it } from "vitest";
import {
  buildFilterData,
  countActiveFilters,
  getAllFilterItems,
} from "../lib/filters/filter-builder";
import type { FilterParams } from "../lib/filters/filter-types";

describe("buildFilterData", () => {
  const emptyParams: FilterParams = {};

  it("returns empty array when all filters are at defaults", () => {
    expect(buildFilterData(emptyParams)).toEqual([]);
  });

  describe("search section", () => {
    it("creates search section when field differs from default", () => {
      const sections = buildFilterData({ field: "title" });
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe("search");
      expect(sections[0].items[0]).toMatchObject({
        key: "field",
        type: "field",
      });
    });

    it("creates search section when sortBy differs from default", () => {
      const sections = buildFilterData({ sortBy: "cited_by_count:desc" });
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe("search");
      expect(sections[0].items[0]).toMatchObject({
        key: "sort",
        type: "sort",
      });
    });
  });

  describe("time section", () => {
    it("creates time section for year filter with range display", () => {
      const sections = buildFilterData({
        filterType: "year",
        yearRange: [2020, 2024],
        isYearRangeEnabled: true,
      });
      const timeSection = sections.find((s) => s.id === "time");
      expect(timeSection).toBeDefined();
      expect(timeSection!.items[0]).toMatchObject({
        key: "year",
        displayValue: "2020 - 2024",
      });
    });

    it("displays single year when from equals to", () => {
      const sections = buildFilterData({
        filterType: "year",
        yearRange: [2024, 2024],
        isYearRangeEnabled: true,
      });
      const timeSection = sections.find((s) => s.id === "time");
      expect(timeSection).toBeDefined();
      expect(timeSection!.items[0]).toMatchObject({
        displayValue: "2024",
      });
    });

    it("creates time section for date filter", () => {
      const sections = buildFilterData({
        filterType: "date",
        dateRange: { from: new Date("2024-01-15") },
      });
      const timeSection = sections.find((s) => s.id === "time");
      expect(timeSection).toBeDefined();
      expect(timeSection!.items[0]).toMatchObject({
        key: "date",
      });
    });
  });

  describe("geographic section", () => {
    it("creates geographic section for regions", () => {
      const sections = buildFilterData({
        selectedRegions: ["africa", "US"],
      });
      const geoSection = sections.find((s) => s.id === "geographic");
      expect(geoSection).toBeDefined();
      expect(geoSection!.items[0]).toMatchObject({
        key: "regions",
        type: "regions",
      });
    });

    it("creates geographic section for country focus", () => {
      const sections = buildFilterData({
        selectedCountryFocus: ["US", "GB"],
      });
      const geoSection = sections.find((s) => s.id === "geographic");
      expect(geoSection).toBeDefined();
      expect(geoSection!.items[0]).toMatchObject({
        key: "countryFocus",
        type: "countryFocus",
      });
    });
  });

  describe("content section", () => {
    it("creates content section for review filter", () => {
      const sections = buildFilterData({ reviewFilter: true });
      const contentSection = sections.find((s) => s.id === "content");
      expect(contentSection).toBeDefined();
      expect(contentSection!.items[0]).toMatchObject({
        key: "review",
        displayValue: "Reviews only",
      });
    });
  });

  describe("ratings section", () => {
    it("creates ratings section for rating range", () => {
      const sections = buildFilterData({
        ratingRange: [3, 5],
        onlyRatedPapers: true,
      });
      const ratingsSection = sections.find((s) => s.id === "ratings");
      expect(ratingsSection).toBeDefined();
      const ratingItem = ratingsSection!.items.find((i) => i.key === "rating");
      expect(ratingItem).toBeDefined();
      expect(ratingItem!.displayValue).toContain("3");
      expect(ratingItem!.displayValue).toContain("5");
    });

    it("creates ratings section for onlyRated", () => {
      const sections = buildFilterData({ onlyRatedPapers: true });
      const ratingsSection = sections.find((s) => s.id === "ratings");
      expect(ratingsSection).toBeDefined();
      const onlyRatedItem = ratingsSection!.items.find(
        (i) => i.key === "onlyRated"
      );
      expect(onlyRatedItem).toBeDefined();
    });
  });

  describe("citations section", () => {
    it("creates citations section for cites", () => {
      const sections = buildFilterData({ citesItemId: "W123" });
      const citationsSection = sections.find((s) => s.id === "citations");
      expect(citationsSection).toBeDefined();
      expect(citationsSection!.items[0]).toMatchObject({
        key: "cites",
        displayValue: "W123",
      });
    });

    it("creates citations section for citedBy", () => {
      const sections = buildFilterData({ citedByItemId: "W456" });
      const citationsSection = sections.find((s) => s.id === "citations");
      expect(citationsSection).toBeDefined();
      expect(citationsSection!.items[0]).toMatchObject({
        key: "citedBy",
        displayValue: "W456",
      });
    });

    it("creates citations section for relatedTo", () => {
      const sections = buildFilterData({ relatedToItemId: "W789" });
      const citationsSection = sections.find((s) => s.id === "citations");
      expect(citationsSection).toBeDefined();
      expect(citationsSection!.items[0]).toMatchObject({
        key: "relatedTo",
        displayValue: "W789",
      });
    });
  });

  it("creates multiple sections for combined filters", () => {
    const sections = buildFilterData({
      field: "title",
      filterType: "year",
      yearRange: [2020, 2024],
      isYearRangeEnabled: true,
      citesItemId: "W100",
    });
    const sectionIds = sections.map((s) => s.id);
    expect(sectionIds).toContain("search");
    expect(sectionIds).toContain("time");
    expect(sectionIds).toContain("citations");
    expect(sections).toHaveLength(3);
  });
});

describe("countActiveFilters", () => {
  it("returns zero for empty params", () => {
    expect(countActiveFilters({})).toBe(0);
  });

  it("counts across sections", () => {
    expect(
      countActiveFilters({
        field: "title",
        reviewFilter: true,
        citesItemId: "W123",
      })
    ).toBe(3);
  });
});

describe("getAllFilterItems", () => {
  it("returns empty array for default params", () => {
    expect(getAllFilterItems({})).toEqual([]);
  });

  it("flattens all items across sections", () => {
    const items = getAllFilterItems({
      field: "title",
      reviewFilter: true,
      citesItemId: "W123",
    });
    expect(items).toHaveLength(3);
  });
});
