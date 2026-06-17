import { describe, it, expect } from "vitest";
import { buildOpenAlexSearchParams } from "./search-params";

const filterOf = (f: Parameters<typeof buildOpenAlexSearchParams>[0]) =>
  buildOpenAlexSearchParams(f).get("filter") ?? "";

describe("buildOpenAlexSearchParams — search field + wildcard routing", () => {
  it("uses the stemmed title_and_abstract.search for a plain query", () => {
    const filter = filterOf({
      query: "machine learning",
      searchField: "title_and_abstract",
    });
    expect(filter).toContain("title_and_abstract.search:machine learning");
    expect(filter).not.toContain(".search.exact");
  });

  it("routes an unquoted wildcard query to the no-stem .search.exact field", () => {
    const filter = filterOf({
      query: "(AI OR impact) AND transform*",
      searchField: "title_and_abstract",
    });
    expect(filter).toContain(
      "title_and_abstract.search.exact:(AI OR impact) AND transform*"
    );
  });

  it("keeps the stemmed field when the only wildcard is inside quotes", () => {
    const filter = filterOf({
      query: '"transform*"',
      searchField: "title_and_abstract",
    });
    expect(filter).toContain('title_and_abstract.search:"transform*"');
    expect(filter).not.toContain(".search.exact");
  });

  it("routes wildcards on the title field too", () => {
    expect(filterOf({ query: "transform*", searchField: "title" })).toContain(
      "title.search.exact:transform*"
    );
  });

  it("detects ? as a wildcard", () => {
    expect(
      filterOf({ query: "behaviou?r", searchField: "title_and_abstract" })
    ).toContain("title_and_abstract.search.exact:behaviou?r");
  });
});

describe("buildOpenAlexSearchParams — baseline wire format", () => {
  it("sets per-page to 200 and a select list by default", () => {
    const params = buildOpenAlexSearchParams({
      query: "x",
      searchField: "title_and_abstract",
    });
    expect(params.get("per-page")).toBe("200");
    expect(params.get("select")).toContain("display_name");
  });

  it("includes year and review filters in the comma-joined filter", () => {
    const filter = filterOf({
      query: "x",
      searchField: "title_and_abstract",
      yearRange: [2010, 2020],
      reviewFilter: true,
    });
    expect(filter).toContain("publication_year:2010-2020");
    expect(filter).toContain("type:review");
  });
});
