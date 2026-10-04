import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/actions/openalex", () => ({ getSearchResults: vi.fn() }));
import { DEFAULT_SEARCH_PARAMS } from "@/lib/search-params";
import { paramsToBucketSearchFilters } from "@/lib/chat/params-to-bucket-filters";
import { buildOpenAlexWorksQuery } from "@/lib/openalex/works-query";
import { expandShortcuts } from "@/lib/query-shortcuts";

const noShortcuts = (query: string) => expandShortcuts(query, {});

describe("paramsToBucketSearchFilters", () => {
  it("keeps the exact request the results page makes, which chat and extraction run", () => {
    const params = {
      ...DEFAULT_SEARCH_PARAMS,
      q: "education",
      focus: ["KE"],
      reg: ["KE"],
      review: true,
      sort: "cited_by_count:desc",
    };
    const stored = paramsToBucketSearchFilters(params, { expand: noShortcuts });
    expect(stored).toEqual({
      query: "education",
      openAlexQuery: { ...buildOpenAlexWorksQuery(params, { expand: noShortcuts }), sort: "cited_by_count:desc" },
    });
    // Country focus and reviews become search terms and institution location a
    // countries filter, as on the results page; OpenAlex rejects the old
    // `countries:` and `regions:` clauses the server used to build.
    expect(stored?.openAlexQuery.filter).toContain('("Kenya")) AND (review OR synthesis OR "meta-analysis")');
    expect(stored?.openAlexQuery.filter).toContain("authorships.countries:KE");
  });

  it("sorts a search without a query newest first, as the results page does", () => {
    const stored = paramsToBucketSearchFilters({ ...DEFAULT_SEARCH_PARAMS, oa: true }, { expand: noShortcuts });
    expect(stored?.openAlexQuery.sort).toBe("publication_date:desc");
  });

  it("returns nothing for an invalid query and says why", () => {
    const onWarning = vi.fn();
    expect(paramsToBucketSearchFilters({ ...DEFAULT_SEARCH_PARAMS, q: "a" }, { expand: noShortcuts, onWarning })).toBeNull();
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("Single character"));
  });
});
