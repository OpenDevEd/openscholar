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

  it("gives up after a minute in all, its tries and waits included", async () => {
    vi.useFakeTimers();
    const hanging = vi.fn((_url: URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    vi.stubGlobal("fetch", hanging);
    const page = fetchWorksPage({ perPage: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await page).toEqual({ ok: false, status: null, message: "Search request timed out" });
    expect(hanging).toHaveBeenCalledTimes(1);

    // Each try answers a 503 after 25 s, as fetch does, unless the deadline aborts it first.
    const slow = vi.fn((_url: URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response("{}", { status: 503 })), 25_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        });
      }));
    vi.stubGlobal("fetch", slow);
    const retried = fetchWorksPage({ perPage: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await retried).toEqual({ ok: false, status: null, message: "Search request timed out" });
    expect(slow).toHaveBeenCalledTimes(3);
  });

  it("passes a work as OpenAlex and the OpenScholar API give it, its fields missing or null where they may be", async () => {
    const work = {
      id: "https://openscholar.ai/OS1", display_name: "Paper", title: "Paper", doi: null, type: "article", language: null,
      publication_year: 2020, cited_by_count: 3, abstract_inverted_index: null,
      authorships: [{ author: { id: null, display_name: "Ada Lovelace" }, institutions: [] }],
      primary_location: null, open_access: { is_oa: false, oa_url: null },
      primary_topic: {
        id: "https://openalex.org/T10032", display_name: "Kelp forests",
        subfield: { id: "https://openalex.org/subfields/2303", display_name: "Ecology" },
        field: { id: "https://openalex.org/fields/23", display_name: "Environmental Science" },
        domain: { id: "https://openalex.org/domains/3", display_name: "Physical Sciences" },
      },
      related_works: [], referenced_works: ["https://openscholar.ai/OS2"], sustainable_development_goals: [], biblio: { volume: null },
    };
    answering({ status: 200, body: { meta: { count: 2 }, results: [work, { id: "https://openalex.org/W2" }] } });
    // The page shows an abstract as text, so its index goes, as the SDK dropped it.
    const { abstract_inverted_index: _index, ...shown } = work;
    expect(await fetchWorksPage({ perPage: 2 })).toEqual({ ok: true, data: { meta: { count: 2 }, results: [shown, { id: "https://openalex.org/W2" }] } });
  });

  it("says the search failed when an answer is not a page of works, rather than throw or pass it on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const page = (work: Record<string, unknown>) => ({ meta: { count: 1 }, results: [{ id: "W1", ...work }] });
    const bodies = [
      { meta: { count: 1 } },
      { results: [] },
      page({ abstract_inverted_index: { word: "0" } }),
      // Fields the paper card loops over or reads into, in a shape it cannot.
      page({ authorships: {} }),
      page({ authorships: [{ author: null }] }),
      page({ authorships: [{}] }),
      page({ display_name: { text: "Paper" } }),
      page({ related_works: 3 }),
      page({ open_access: "yes" }),
      page({ primary_topic: { field: "Ecology" } }),
      "not json",
    ];
    for (const body of bodies) {
      answering({ status: 200, body });
      expect(await fetchWorksPage({ perPage: 1 })).toEqual({ ok: false, status: null, message: "Search request failed" });
    }
  });
});
