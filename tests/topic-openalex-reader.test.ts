import {afterEach, expect, it, vi} from "vitest";
import {readOpenAlexWorks} from "../lib/openalex/read-works";
vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());
it("reads exactly the supplied cursor and preserves card metadata and abstracts", async () => {
  const fetchMock = vi.fn(async (_url: URL) => Response.json({meta: {count: 40001, next_cursor: "next-page"}, results: [{id: "https://openalex.org/W123", title: "A paper", publication_year: 2026, abstract_inverted_index: {Good: [0], evidence: [1]}, sustainable_development_goals: []}]}));
  vi.stubGlobal("fetch", fetchMock);
  const result = await readOpenAlexWorks({filter: {...{topics: {id: "T12260"}}, is_paratext: false}, cursor: "provider-cursor", perPage: 10});
  expect(result).toMatchObject({meta: {count: 40001, next_cursor: "next-page"}, results: [{id: "https://openalex.org/W123", title: "A paper", abstract: "Good evidence"}]});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetchMock.mock.calls[0][0]));
  expect(url.searchParams.get("cursor")).toBe("provider-cursor");
  expect(url.searchParams.get("filter")).toContain("topics.id:T12260");
});
it("returns a provider failure instead of an empty completed page", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 503})));
  await expect(readOpenAlexWorks({cursor: "*"})).rejects.toThrow("503");
});
it("refuses a page with a work in a shape the cards cannot read", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({meta: {count: 1, next_cursor: null}, results: [{id: "https://openalex.org/W1", authorships: [{author: null}]}]})));
  await expect(readOpenAlexWorks({cursor: "*"})).rejects.toThrow();
});
