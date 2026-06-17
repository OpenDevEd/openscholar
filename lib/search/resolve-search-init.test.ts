import { describe, it, expect } from "vitest";
import { resolveSearchInit } from "./resolve-search-init";
import { DEFAULT_SEARCH_PARAMS } from "../search-params/parsers";
import type { ParsedSearchParams } from "../search-params/parsers";
import {
  paramsToSearchResult,
  searchResultToParams,
} from "../search-params/converters";
import { buildResultsUrl } from "../search-params";
import type { SearchResult } from "@/lib/types";

const params = (o?: Partial<ParsedSearchParams>): ParsedSearchParams => ({
  ...DEFAULT_SEARCH_PARAMS,
  ...o,
});

const entry = (o?: Partial<SearchResult>): SearchResult =>
  ({
    id: "abc",
    query: "",
    queryHistory: [],
    questionHistory: [],
    screeningQuestions: [],
    screeningResponses: {},
    count: 0,
    field: "title_and_abstract",
    sortBy: "relevance_score:desc",
    filterType: "year",
    createdAt: 0,
    updatedAt: 0,
    ...o,
  }) as SearchResult;

const canonicalFor = (id: string, p: ParsedSearchParams) =>
  buildResultsUrl(id, searchResultToParams({ ...paramsToSearchResult(p), id }));

describe("resolveSearchInit — Branch A (create on missing/unknown id)", () => {
  it("creates a new entry when there is no searchId (bare /results)", () => {
    const d = resolveSearchInit({
      searchId: "",
      parsedParams: params(),
      hasExplicitParams: false,
      existingEntry: undefined,
      currentUrl: "/results",
    });
    expect(d.kind).toBe("create");
    if (d.kind === "create") expect(d.entry.query).toBe("");
  });

  it("creates a new entry for an unknown searchId", () => {
    const d = resolveSearchInit({
      searchId: "probe123",
      parsedParams: params(),
      hasExplicitParams: false,
      existingEntry: undefined,
      currentUrl: "/results/probe123",
    });
    expect(d.kind).toBe("create");
  });

  it("preserves the query when creating from an unknown id with ?q", () => {
    const d = resolveSearchInit({
      searchId: "probe123",
      parsedParams: params({ q: "machine learning" }),
      hasExplicitParams: true,
      existingEntry: undefined,
      currentUrl: "/results/probe123?q=machine+learning",
    });
    expect(d.kind).toBe("create");
    if (d.kind === "create") expect(d.entry.query).toBe("machine learning");
  });
});

describe("resolveSearchInit — Branch B (restore stored state)", () => {
  it("redirects a known id with no params to the canonical URL of the stored entry", () => {
    const d = resolveSearchInit({
      searchId: "abc",
      parsedParams: params(),
      hasExplicitParams: false,
      existingEntry: entry({ id: "abc", query: "ml" }),
      currentUrl: "/results/abc",
    });
    expect(d.kind).toBe("redirect");
    if (d.kind === "redirect") {
      expect(d.url).toContain("/results/abc");
      expect(d.url).toContain("q=ml");
    }
  });
});

describe("resolveSearchInit — Branch C (sync + canonicalize)", () => {
  it("is ready when params match the entry and the URL is already canonical", () => {
    const canonical = canonicalFor("abc", params());
    const d = resolveSearchInit({
      searchId: "abc",
      parsedParams: params(),
      hasExplicitParams: true,
      existingEntry: entry({ id: "abc" }),
      currentUrl: canonical,
    });
    expect(d.kind).toBe("ready");
  });

  it("redirects to canonicalize when params match but the URL is non-canonical", () => {
    const canonical = canonicalFor("abc", params());
    const d = resolveSearchInit({
      searchId: "abc",
      parsedParams: params(),
      hasExplicitParams: true,
      existingEntry: entry({ id: "abc" }),
      currentUrl: "/results/abc?reg=&focus=",
    });
    expect(d.kind).toBe("redirect");
    if (d.kind === "redirect") expect(d.url).toBe(canonical);
  });

  it("syncs and records query history when the query changed", () => {
    const d = resolveSearchInit({
      searchId: "abc",
      parsedParams: params({ q: "ai" }),
      hasExplicitParams: true,
      existingEntry: entry({ id: "abc", query: "ml" }),
      currentUrl: "/results/abc?q=ai",
    });
    expect(d.kind).toBe("sync");
    if (d.kind === "sync") {
      expect(d.addQuery).toBe("ai");
      expect(d.filterUpdates).not.toHaveProperty("query");
      expect(d.filterUpdates).not.toHaveProperty("count");
    }
  });

  it("treats a differently-encoded but equivalent URL as already canonical (no redirect loop)", () => {
    // buildResultsUrl (nuqs) leaves '(' ')' unencoded; the browser's
    // searchParams.toString() encodes them as %28/%29. The same query must NOT
    // be seen as non-canonical, or the initializer redirect-loops on it.
    const p = params({ q: "(ai OR ml)" });
    const nuqsUrl = canonicalFor("abc", p); // parens unencoded
    const browserEncoded = nuqsUrl.replace(/\(/g, "%28").replace(/\)/g, "%29");
    const d = resolveSearchInit({
      searchId: "abc",
      parsedParams: p,
      hasExplicitParams: true,
      existingEntry: entry({ id: "abc", query: "(ai OR ml)" }),
      currentUrl: browserEncoded,
    });
    expect(d.kind).toBe("ready");
  });

  it("syncs without recording query history when only a filter changed", () => {
    const d = resolveSearchInit({
      searchId: "abc",
      parsedParams: params({ q: "ml", rmin: 2 }),
      hasExplicitParams: true,
      existingEntry: entry({ id: "abc", query: "ml" }),
      currentUrl: "/results/abc?q=ml&rmin=2",
    });
    expect(d.kind).toBe("sync");
    if (d.kind === "sync") {
      expect(d.addQuery).toBeNull();
      expect(d.filterUpdates.ratingRange).toEqual([2, 5]);
    }
  });
});
