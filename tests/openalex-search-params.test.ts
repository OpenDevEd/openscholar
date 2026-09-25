import { describe, it, expect } from "vitest";
import {
  OPENALEX_WORK_SELECT_FIELDS,
  buildOpenAlexSearchParams,
} from "../lib/openalex/search-params";

/**
 * Pure tests for buildOpenAlexSearchParams — the query-string chat and
 * extraction send. The search itself is the stored request the results page
 * made; this adds only paging and the fields the mapper reads.
 */

const stored = { filter: "title_and_abstract.search:q,is_retracted:false", sort: "relevance_score:desc" };
const build = (limit?: number) => buildOpenAlexSearchParams({ openAlexQuery: stored, limit });

describe("buildOpenAlexSearchParams — stored request", () => {
  it("sends the stored search, filter and sort unchanged", () => {
    const p = buildOpenAlexSearchParams({
      openAlexQuery: { search: "ebola", filter: "authorships.countries:KE", sort: "cited_by_count:asc" },
    });
    expect(p.get("search")).toBe("ebola");
    expect(p.get("filter")).toBe("authorships.countries:KE");
    expect(p.get("sort")).toBe("cited_by_count:asc");
  });

  it("leaves out search and filter the stored request does not have", () => {
    const p = buildOpenAlexSearchParams({ openAlexQuery: { sort: "publication_date:desc" } });
    expect(p.get("search")).toBeNull();
    expect(p.get("filter")).toBeNull();
  });
});

describe("buildOpenAlexSearchParams — pagination", () => {
  it("defaults per-page to 200 when limit is unset", () => {
    expect(build().get("per-page")).toBe("200");
  });

  it("uses a configured limit as per-page", () => {
    expect(build(50).get("per-page")).toBe("50");
  });

  it("clamps per-page to 200 when limit exceeds OpenAlex's single-page ceiling", () => {
    expect(build(500).get("per-page")).toBe("200");
  });

  it("floors a fractional limit to an integer per-page", () => {
    expect(build(99.7).get("per-page")).toBe("99");
  });

  it("throws when limit is 0 — a zero-paper source must be skipped upstream, not silently fetched as 200", () => {
    expect(() => build(0)).toThrow(/limit must be >= 1/);
  });

  it("throws when limit is negative", () => {
    expect(() => build(-10)).toThrow(/limit must be >= 1/);
  });

  it("honors limit=1 as the minimum valid page size", () => {
    expect(build(1).get("per-page")).toBe("1");
  });
});

describe("buildOpenAlexSearchParams — select= field allowlist", () => {
  it("emits a select param so OpenAlex returns only fields the mapper reads", () => {
    const fields = (build().get("select") ?? "").split(",");
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
    expect(build().get("select")).toBe(OPENALEX_WORK_SELECT_FIELDS.join(","));
  });
});
