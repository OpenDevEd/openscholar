import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWorksPage } from "./works-page";

/** Answers each request in turn, `body` as JSON unless it is text. */
function answering(...answers: { status: number; body: unknown }[]) {
  const fetchMock = vi.fn();
  for (const { status, body } of answers) {
    fetchMock.mockResolvedValueOnce(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchWorksPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("says the search failed when an answer is not a page of works, rather than throw or pass it on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bodies = [
      { meta: { count: 1 } },
      { results: [] },
      { meta: { count: 1 }, results: [{ id: "W1", abstract_inverted_index: { word: "0" } }] },
      "not json",
    ];
    for (const body of bodies) {
      answering({ status: 200, body });
      expect(await fetchWorksPage({ perPage: 1 })).toEqual({ ok: false, status: null, message: "Search request failed" });
    }
  });
});
