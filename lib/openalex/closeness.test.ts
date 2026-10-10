import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchClosenessOrder } from "./closeness";

/** Answers each request in turn, `body` as JSON. */
function answering(...answers: { status: number; body: unknown }[]) {
  const fetchMock = vi.fn();
  for (const { status, body } of answers) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchClosenessOrder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks the OpenScholar API to order the works by the papers alike and unlike, with its key", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
    vi.stubEnv("OPENSCHOLAR_API_KEY", "test-key");
    const fetchMock = answering({
      status: 200,
      body: { meta: { count: 2 }, results: [{ id: "https://openscholar.ai/OS2", relevance_score: 0.21 }, { id: "https://openscholar.ai/OS1", relevance_score: null }] },
    });
    expect(await fetchClosenessOrder(["OS1", "OS2"], ["OS7"], ["OS8", "OS9"])).toEqual({
      ok: true,
      order: [{ id: "https://openscholar.ai/OS2", score: 0.21 }, { id: "https://openscholar.ai/OS1", score: null }],
    });
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe("/works/closeness");
    expect(Object.fromEntries(url.searchParams)).toEqual({ works: "OS1|OS2", similar_to: "OS7", dissimilar_to: "OS8|OS9", api_key: "test-key" });
  });

  it("asks without dissimilar_to when no paper is rated low", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
    const fetchMock = answering({ status: 200, body: { meta: { count: 0 }, results: [] } });
    await fetchClosenessOrder(["OS1"], ["OS7"], []);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.has("dissimilar_to")).toBe(false);
  });

  it("gives the API's reason for a refusal, and fails on an answer it can't read", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
    answering(
      { status: 400, body: { error: "Invalid query parameters error.", message: "similar_to: none of the works named is in the vector index" } },
      { status: 200, body: { results: [{ id: "https://openscholar.ai/OS1" }] } },
    );
    expect(await fetchClosenessOrder(["OS1"], ["OS404"], [])).toEqual({
      ok: false,
      status: 400,
      message: "similar_to: none of the works named is in the vector index",
    });
    expect(await fetchClosenessOrder(["OS1"], ["OS7"], [])).toEqual({ ok: false, status: null, message: "Ordering request failed" });
  });

  it("orders nothing without the OpenScholar API, which alone has the order", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "");
    const fetchMock = answering();
    expect(await fetchClosenessOrder(["W1"], ["W2"], [])).toMatchObject({ ok: false, status: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
