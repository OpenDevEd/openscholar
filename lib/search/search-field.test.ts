import { describe, it, expect } from "vitest";
import { buildSearchSubfilter } from "./search-field";

describe("buildSearchSubfilter", () => {
  it("uses the stemmed .search field for a plain query", () => {
    expect(buildSearchSubfilter("machine learning")).toEqual({
      search: "machine learning",
    });
  });

  it("routes to the no-stem .search.exact field when the query has an unquoted wildcard", () => {
    expect(buildSearchSubfilter("transform*")).toEqual({
      search: { exact: "transform*" },
    });
  });

  it("keeps the stemmed field when the only wildcard is inside quotes", () => {
    expect(buildSearchSubfilter('"transform*"')).toEqual({
      search: '"transform*"',
    });
  });
});
