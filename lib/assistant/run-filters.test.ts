import { describe, expect, it } from "vitest";
import { differences } from "./run-filters";

describe("what tells a run of searches apart", () => {
  it("keeps only the settings that aren't the same in all of them, with the switch a range needs", () => {
    const shared = { query: "tutoring", field: "title_and_abstract" as const, openAccessOnly: true, filterType: "year" as const };
    const told = differences([
      { ...shared, selectedCountryFocus: ["KE"], isYearRangeEnabled: true, yearRange: [2010, 2015] as [number, number] },
      { ...shared, selectedCountryFocus: ["GH"], isYearRangeEnabled: true, yearRange: [2016, 2024] as [number, number] },
      { ...shared, selectedCountryFocus: ["NG"] },
    ]);
    expect(told.sameQuery).toBe(true);
    expect(told.filters).toEqual([
      { selectedCountryFocus: ["KE"], yearRange: [2010, 2015], filterType: "year", isYearRangeEnabled: true },
      { selectedCountryFocus: ["GH"], yearRange: [2016, 2024], filterType: "year", isYearRangeEnabled: true },
      { selectedCountryFocus: ["NG"], filterType: "year" },
    ]);
  });

  it("has nothing for a search that only leaves out what the others set, and tells different queries apart", () => {
    const told = differences([
      { query: "phonics", minCitations: 10 },
      { query: "phonics" },
      { query: "phonics programmes", minCitations: 10 },
    ]);
    expect(told.sameQuery).toBe(false);
    expect(told.filters).toEqual([{ minCitations: 10 }, undefined, { minCitations: 10 }]);
    // A switch alone makes no chip, so a line with only that says its query instead.
    expect(differences([{ query: "x", filterType: "date" }, { query: "x", filterType: "year" }]).filters).toEqual([undefined, undefined]);
  });

  it("gives a search kept at a default no chips, keeps an inactive range inactive, and reads picks in any order as the same", () => {
    // Searched in titles against the default fields: only the title search has a chip.
    expect(differences([{ query: "x", field: "title" }, { query: "x", field: "title_and_abstract" }]).filters).toEqual([{ field: "title" }, undefined]);
    // A rating range with "rated only" off is no filter, whatever its ends.
    expect(differences([{ query: "x", ratingRange: [2, 5], onlyRatedPapers: false }, { query: "x" }]).filters).toEqual([undefined, undefined]);
    // The same countries in another order are no difference: only the citation minimum tells them apart.
    expect(differences([{ query: "x", selectedCountryFocus: ["KE", "GH"], minCitations: 5 }, { query: "x", selectedCountryFocus: ["GH", "KE"] }]).filters).toEqual([{ minCitations: 5 }, undefined]);
  });
});
