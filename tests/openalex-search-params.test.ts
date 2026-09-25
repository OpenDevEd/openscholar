import { describe, it, expect } from "vitest";
import {
  OPENALEX_WORK_SELECT_FIELDS,
  buildOpenAlexSearchParams,
} from "../lib/openalex/search-params";

/** Most tests are about one clause, so they turn off the default that leaves out retracted works. */
const build = (filters: Parameters<typeof buildOpenAlexSearchParams>[0]) =>
  buildOpenAlexSearchParams({ includeRetracted: true, ...filters });

/**
 * Pure tests for buildOpenAlexSearchParams — the query-string builder
 * lifted out of convex/extraction/actions.ts. No fetch, no env. Only
 * input → URLSearchParams shape.
 */

describe("buildOpenAlexSearchParams — search field routing", () => {
  it("defaults to the free-text `search` param when no searchField is given", () => {
    const p = build({ query: "ebola" });
    expect(p.get("search")).toBe("ebola");
    expect(p.get("filter")).toBeNull();
  });

  it("maps searchField='title' to filter=title.search:<q>", () => {
    const p = build({ query: "hiv", searchField: "title" });
    expect(p.get("filter")).toBe("title.search:hiv");
  });

  it("maps searchField='abstract' to filter=abstract.search:<q>", () => {
    const p = build({ query: "vaccine", searchField: "abstract" });
    expect(p.get("filter")).toBe("abstract.search:vaccine");
  });

  it("maps searchField='title_and_abstract' to filter=title_and_abstract.search:<q>", () => {
    const p = build({ query: "covid", searchField: "title_and_abstract" });
    expect(p.get("filter")).toBe("title_and_abstract.search:covid");
  });

  it("maps searchField='fulltext' to filter=fulltext.search:<q>", () => {
    const p = build({ query: "cancer", searchField: "fulltext" });
    expect(p.get("filter")).toBe("fulltext.search:cancer");
  });

  it("maps searchField='display_name' to filter=display_name.search:<q>", () => {
    const p = build({ query: "malaria", searchField: "display_name" });
    expect(p.get("filter")).toBe("display_name.search:malaria");
  });
});

describe("buildOpenAlexSearchParams — year and date filters", () => {
  it("serializes yearRange when no dateRange is given", () => {
    const p = build({ query: "q", yearRange: [2020, 2024] });
    expect(p.get("filter")).toContain("publication_year:2020-2024");
  });

  it("prefers dateRange.from over yearRange when both are present", () => {
    const p = build({
      query: "q",
      yearRange: [2020, 2024],
      dateRange: { from: "2023-01-01" },
    });
    expect(p.get("filter")).toContain("from_publication_date:2023-01-01");
    expect(p.get("filter")).not.toContain("publication_year:2020-2024");
  });

  it("emits both from and to date filters when supplied", () => {
    const p = build({
      query: "q",
      dateRange: { from: "2023-01-01", to: "2024-12-31" },
    });
    expect(p.get("filter")).toContain("from_publication_date:2023-01-01");
    expect(p.get("filter")).toContain("to_publication_date:2024-12-31");
  });
});

describe("buildOpenAlexSearchParams — review + geography filters", () => {
  it("adds type:review when reviewFilter is true", () => {
    const p = build({ query: "q", reviewFilter: true });
    expect(p.get("filter")).toContain("type:review");
  });

  it("pipe-joins countries via countries:<a>|<b>", () => {
    const p = build({
      query: "q",
      selectedCountryFocus: ["US", "KE", "ZA"],
    });
    expect(p.get("filter")).toContain("countries:US|KE|ZA");
  });

  it("pipe-joins regions via regions:<a>|<b>", () => {
    const p = build({
      query: "q",
      selectedRegions: ["africa", "asia"],
    });
    expect(p.get("filter")).toContain("regions:africa|asia");
  });

  it("skips geography filters when arrays are empty", () => {
    const p = build({
      query: "q",
      selectedCountryFocus: [],
      selectedRegions: [],
    });
    expect(p.get("filter")).toBeNull();
  });
});

describe("buildOpenAlexSearchParams — type, research area, SDG and open access filters", () => {
  it("writes them as the same clauses the search page sends", () => {
    const p = buildOpenAlexSearchParams({
      query: "",
      workTypes: ["article", "review"],
      researchAreas: ["fields/33", "subfields/3304", "subfields/1702", "T10001"],
      sdgs: ["4", "5"],
      openAccessOnly: true,
      workLanguages: ["en", "fr"],
      institutionTypes: ["government", "nonprofit"],
      funders: ["F4320311904"],
      minCitations: 10,
      hasAbstract: true,
    });
    expect(p.get("filter")?.split(",")).toEqual([
      "type:article|review",
      "topics.field.id:33",
      "topics.subfield.id:3304|1702",
      "topics.id:T10001",
      "sustainable_development_goals.id:https://metadata.un.org/sdg/4|https://metadata.un.org/sdg/5",
      "open_access.is_oa:true",
      "language:en|fr",
      "authorships.institutions.type:government|nonprofit",
      "funders.id:F4320311904",
      "cited_by_count:>9",
      "has_abstract:true",
      "is_retracted:false",
    ]);
  });

  it("leaves out retracted works unless asked to include them", () => {
    expect(buildOpenAlexSearchParams({ query: "q" }).get("filter")).toBe("is_retracted:false");
    expect(buildOpenAlexSearchParams({ query: "q", includeRetracted: true }).get("filter")).toBeNull();
  });
});

describe("buildOpenAlexSearchParams — relationship filters (cites / cited_by / related_to)", () => {
  it("prefixes cites id with https://openalex.org/ when missing", () => {
    const p = build({ query: "q", citesItemId: "W1234" });
    expect(p.get("filter")).toContain("cites:https://openalex.org/W1234");
  });

  it("leaves fully-qualified cites id alone", () => {
    const p = build({
      query: "q",
      citesItemId: "https://openalex.org/W5678",
    });
    expect(p.get("filter")).toContain("cites:https://openalex.org/W5678");
  });

  it("handles cited_by and related_to the same way", () => {
    const p = build({
      query: "q",
      citedByItemId: "W1",
      relatedToItemId: "W2",
    });
    const filter = p.get("filter") ?? "";
    expect(filter).toContain("cited_by:https://openalex.org/W1");
    expect(filter).toContain("related_to:https://openalex.org/W2");
  });
});

describe("buildOpenAlexSearchParams — sort + pagination", () => {
  it("defaults sort direction to desc when sortBy is just a field", () => {
    const p = build({ query: "q", sortBy: "cited_by_count" });
    expect(p.get("sort")).toBe("cited_by_count:desc");
  });

  it("preserves explicit sort direction", () => {
    const p = build({ query: "q", sortBy: "publication_date:asc" });
    expect(p.get("sort")).toBe("publication_date:asc");
  });

  it("defaults per-page to 200 when limit is unset", () => {
    const p = build({ query: "q" });
    expect(p.get("per-page")).toBe("200");
  });

  it("uses a configured limit as per-page", () => {
    const p = build({ query: "q", limit: 50 });
    expect(p.get("per-page")).toBe("50");
  });

  it("clamps per-page to 200 when limit exceeds OpenAlex's single-page ceiling", () => {
    const p = build({ query: "q", limit: 500 });
    expect(p.get("per-page")).toBe("200");
  });

  it("floors a fractional limit to an integer per-page", () => {
    const p = build({ query: "q", limit: 99.7 });
    expect(p.get("per-page")).toBe("99");
  });

  it("throws when limit is 0 — a zero-paper source must be skipped upstream, not silently fetched as 200", () => {
    expect(() =>
      build({ query: "q", limit: 0 }),
    ).toThrow(/limit must be >= 1/);
  });

  it("throws when limit is negative", () => {
    expect(() =>
      build({ query: "q", limit: -10 }),
    ).toThrow(/limit must be >= 1/);
  });

  it("honors limit=1 as the minimum valid page size", () => {
    const p = build({ query: "q", limit: 1 });
    expect(p.get("per-page")).toBe("1");
  });
});

describe("buildOpenAlexSearchParams — select= field allowlist", () => {
  it("emits a select param so OpenAlex returns only fields the mapper reads", () => {
    const p = build({ query: "q" });
    const select = p.get("select");
    expect(select).not.toBeNull();
    const fields = (select ?? "").split(",");
    // Every field the work-mapper reads must be in the allowlist —
    // otherwise OpenAlex strips it from the response and the chat
    // prompt loses citation count / venue / type silently.
    for (const required of [
      "id",
      "display_name",
      "doi",
      "publication_year",
      "abstract_inverted_index",
      "authorships",
      "open_access",
      "cited_by_count",
      "primary_location",
      "type",
    ]) {
      expect(fields).toContain(required);
    }
  });

  it("OPENALEX_WORK_SELECT_FIELDS is the source of truth for the select= value", () => {
    const p = build({ query: "q" });
    expect(p.get("select")).toBe(OPENALEX_WORK_SELECT_FIELDS.join(","));
  });
});

describe("buildOpenAlexSearchParams — filter composition", () => {
  it("comma-joins multiple filters in a single filter= param", () => {
    const p = build({
      query: "q",
      searchField: "title",
      yearRange: [2020, 2024],
      reviewFilter: true,
    });
    const filter = p.get("filter") ?? "";
    expect(filter.split(",")).toEqual([
      "title.search:q",
      "publication_year:2020-2024",
      "type:review",
    ]);
  });

  it("emits no filter param when only a free-text query is given", () => {
    const p = build({ query: "q" });
    expect(p.get("filter")).toBeNull();
    expect(p.get("search")).toBe("q");
  });
});
