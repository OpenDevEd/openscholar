import { describe, expect, it } from "vitest";
import {
  isDateFilterActive,
  isRatingFilterActive,
  isCountryFilterActive,
  isCountryFocusActive,
  isCitesFilterActive,
  isCitedByFilterActive,
  isRelatedToFilterActive,
  isReviewFilterActive,
} from "../lib/utils";

describe("isDateFilterActive", () => {
  it("returns false for year filter when not enabled", () => {
    expect(
      isDateFilterActive(undefined, [2020, 2025], "year", false)
    ).toBe(false);
  });

  it("returns true for year filter when enabled", () => {
    expect(
      isDateFilterActive(undefined, [2020, 2025], "year", true)
    ).toBe(true);
  });

  it("returns true for date filter with dateRange present", () => {
    expect(
      isDateFilterActive(
        { from: new Date("2024-01-01") },
        undefined,
        "date",
        false
      )
    ).toBe(true);
  });

  it("returns false for date filter without dateRange", () => {
    expect(
      isDateFilterActive(undefined, undefined, "date", false)
    ).toBe(false);
  });

  it("returns true for undefined filterType with year enabled (fallback)", () => {
    expect(
      isDateFilterActive(undefined, [2020, 2025], undefined, true)
    ).toBe(true);
  });

  it("returns false when everything is undefined", () => {
    expect(
      isDateFilterActive(undefined, undefined, undefined, undefined)
    ).toBe(false);
  });
});

describe("isRatingFilterActive", () => {
  it("returns false when onlyRated is false regardless of range", () => {
    expect(isRatingFilterActive([3, 5], false)).toBe(false);
  });

  it("returns true when onlyRated is true with default range", () => {
    expect(isRatingFilterActive([0, 5], true)).toBe(true);
  });

  it("returns true when onlyRated is true with custom range", () => {
    expect(isRatingFilterActive([2, 4], true)).toBe(true);
  });

  it("returns false when onlyRated is undefined with default range", () => {
    expect(isRatingFilterActive([0, 5], undefined)).toBe(false);
  });

  it("returns true when onlyRated is undefined with custom range", () => {
    expect(isRatingFilterActive([2, 4], undefined)).toBe(true);
  });

  it("returns false when everything is undefined", () => {
    expect(isRatingFilterActive(undefined, undefined)).toBe(false);
  });
});

describe("isCountryFilterActive", () => {
  it("returns true for non-empty array", () => {
    expect(isCountryFilterActive(["africa", "US"])).toBe(true);
  });

  it("returns false for empty array", () => {
    expect(isCountryFilterActive([])).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isCountryFilterActive(undefined)).toBe(false);
  });
});

describe("isCountryFocusActive", () => {
  it("returns true for non-empty array", () => {
    expect(isCountryFocusActive(["US"])).toBe(true);
  });

  it("returns false for empty array", () => {
    expect(isCountryFocusActive([])).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isCountryFocusActive(undefined)).toBe(false);
  });
});

describe("isCitesFilterActive", () => {
  it("returns true for non-empty string", () => {
    expect(isCitesFilterActive("W123")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isCitesFilterActive("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isCitesFilterActive(undefined)).toBe(false);
  });
});

describe("isCitedByFilterActive", () => {
  it("returns true for non-empty string", () => {
    expect(isCitedByFilterActive("W456")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isCitedByFilterActive("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isCitedByFilterActive(undefined)).toBe(false);
  });
});

describe("isRelatedToFilterActive", () => {
  it("returns true for non-empty string", () => {
    expect(isRelatedToFilterActive("W789")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isRelatedToFilterActive("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isRelatedToFilterActive(undefined)).toBe(false);
  });
});

describe("isReviewFilterActive", () => {
  it("returns true when reviewFilter is true", () => {
    expect(isReviewFilterActive(true)).toBe(true);
  });

  it("returns false when reviewFilter is false", () => {
    expect(isReviewFilterActive(false)).toBe(false);
  });

  it("returns false when reviewFilter is undefined", () => {
    expect(isReviewFilterActive(undefined)).toBe(false);
  });
});
