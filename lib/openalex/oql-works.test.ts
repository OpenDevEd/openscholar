import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOqlWorks } from "./oql-works";

const OQL = "works where (title/abstract has (kelp))";

function answering(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchOqlWorks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("posts the query and answers its works, each abstract as text", async () => {
    const fetchMock = answering(200, { meta: { count: 1 }, results: [{ id: "https://openscholar.ai/OS1", abstract_inverted_index: { kelp: [1], Giant: [0] } }] });
    expect(await fetchOqlWorks(OQL, { perPage: 10 })).toEqual({
      ok: true,
      data: { meta: { count: 1 }, results: [{ id: "https://openscholar.ai/OS1", abstract: "Giant kelp" }] },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ oql: OQL });
  });

  it("says the search failed when a work comes in a shape the app cannot read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answering(200, { meta: { count: 1 }, results: [{ id: "W1", authorships: [{ author: null }] }] });
    expect(await fetchOqlWorks(OQL, { perPage: 10 })).toEqual({ ok: false, status: null, message: "Search request failed" });
  });

  it("gives up after a minute", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))));
    const page = fetchOqlWorks(OQL, { perPage: 10 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await page).toEqual({ ok: false, status: null, message: "Search request timed out" });
  });
});
