import { describe, it, expect } from "vitest";
import { searchResultToParams } from "./converters";

describe("searchResultToParams — selection sanitization", () => {
  it("trims and drops empty region codes before they reach the URL params", () => {
    const params = searchResultToParams({
      selectedRegions: ["  us ", "", "uk", "  "],
    });
    expect(params.reg).toEqual(["us", "uk"]);
  });

  it("omits a region selection that is entirely empty/whitespace", () => {
    const params = searchResultToParams({ selectedRegions: ["", "  "] });
    expect(params.reg).toBeUndefined();
  });

  it("trims and keeps country-focus codes", () => {
    const params = searchResultToParams({
      selectedCountryFocus: [" KE ", "TZ"],
    });
    expect(params.focus).toEqual(["KE", "TZ"]);
  });

  it("omits an empty country focus", () => {
    const params = searchResultToParams({ selectedCountryFocus: [] });
    expect(params.focus).toBeUndefined();
  });
});
