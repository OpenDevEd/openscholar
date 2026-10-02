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
    vi.useRealTimers();
  });

  it("asks again after a passing failure, as the SDK did, a second apart", async () => {
    vi.useFakeTimers();
    const fetchMock = answering({ status: 503, body: {} }, { status: 429, body: {} }, { status: 200, body: { meta: { count: 0 }, results: [] } });
    const page = fetchWorksPage({ perPage: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await page).toEqual({ ok: true, data: { meta: { count: 0 }, results: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops after five tries with the last answer's reason, and never asks again after a refusal", async () => {
    vi.useFakeTimers();
    const busy = answering(...Array.from({ length: 5 }, () => ({ status: 503, body: { message: "busy" } })));
    const page = fetchWorksPage({ perPage: 1 });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await page).toEqual({ ok: false, status: 503, message: "busy" });
    expect(busy).toHaveBeenCalledTimes(5);
    const refused = answering({ status: 400, body: { message: "bad filter" } });
    expect(await fetchWorksPage({ perPage: 1 })).toEqual({ ok: false, status: 400, message: "bad filter" });
    expect(refused).toHaveBeenCalledTimes(1);
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
