import { afterEach, describe, expect, it, vi } from "vitest";
import { openAlexFetch } from "../openalex/fetch";
import { searchHeaders, searchUrl } from "../openalex/request-url";
import { appWork, selectWithIds } from "../openalex/work-id";
import { paperIdOf, paperKey, paperPage, parsePaperKey, toPaperKey } from "../papers/paper-ref";
import { autocompleteParameters } from "../openalex/autocomplete";
import { authorFilterValue, isAuthorId } from "../openalex/author-filter";
import { fetchOqlWorks } from "../openalex/oql-works";
import { fetchOwnWorks } from "../openalex/read-works";
import { sourceForId } from "./source";

afterEach(() => vi.unstubAllEnvs());

const ownApi = () => {
  vi.stubEnv("OPENSCHOLAR_API_URL", "https://search.test");
  vi.stubEnv("OPENSCHOLAR_API_KEY", "own-key");
  vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_ID", "access-id");
  vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_SECRET", "access-secret");
  vi.stubEnv("OPENALEX_API_KEY", "openalex-key");
};

describe("each source gets only its own secrets", () => {
  it("sends our key and token to our index, and OpenAlex's key nowhere near it", () => {
    ownApi();
    const url = searchUrl("openscholar", "/works", { search: "school" });
    expect(url.origin).toBe("https://search.test");
    expect(url.searchParams.get("api_key")).toBeNull();
    expect(searchHeaders(url).headers).toEqual({ Authorization: "Bearer own-key", "CF-Access-Client-Id": "access-id", "CF-Access-Client-Secret": "access-secret" });
    expect(searchHeaders(url).redirect).toBe("manual");
  });

  it("sends OpenAlex its key and none of ours", () => {
    ownApi();
    const url = searchUrl("openalex", "works", {});
    expect(url.origin).toBe("https://api.openalex.org");
    expect(url.searchParams.get("api_key")).toBe("openalex-key");
    expect(searchHeaders(url)).toEqual({ headers: {} });
  });

  it("refuses to search our index without its address, and doesn't fall back to OpenAlex", () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "");
    expect(() => searchUrl("openscholar", "works")).toThrow(/OPENSCHOLAR_API_URL/);
  });

  it("asks our index again after a passing failure, but OpenAlex's request goes as it always did", async () => {
    ownApi();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await openAlexFetch(searchUrl("openscholar", "works"))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockReset();
    fetcher.mockResolvedValue(new Response("", { status: 503 }));
    expect((await openAlexFetch(searchUrl("openalex", "works"))).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("a paper's identity", () => {
  it("keeps the OpenAlex ID of a paper OpenAlex knows, so what's saved under it still matches", () => {
    const work = appWork({ id: "https://openscholar.ai/OS79563844", ids: { openalex: "https://openalex.org/W2741809807" } });
    expect(work.id).toBe("https://openalex.org/W2741809807");
    expect(toPaperKey(work.id)).toBe("openalex:W2741809807");
  });

  it("gives a paper only our index has a key of its own, which round-trips", () => {
    const work = appWork({ id: "https://openscholar.ai/OS123", ids: {} });
    const key = toPaperKey(work.id)!;
    expect(key).toBe("openscholar:OS123");
    expect(parsePaperKey(key)).toEqual({ source: "openscholar", work: "OS123" });
    expect(paperKey(parsePaperKey(key)!)).toBe(key);
    expect(paperIdOf(key)).toBe("https://openscholar.ai/OS123");
    expect(paperPage(key)).toBeNull();
  });

  it("asks for the IDs a selection needs to keep the OpenAlex ID", () => {
    expect(selectWithIds("id,doi")).toBe("id,doi,ids");
    expect(selectWithIds("doi")).toBe("doi");
    expect(selectWithIds("id,ids")).toBe("id,ids");
  });
});

describe("IDs and lookups by source", () => {
  it("reads our own IDs on our index whichever source is active, and others on the active source", () => {
    expect(sourceForId("OS123", "openalex")).toBe("openscholar");
    expect(sourceForId("https://openscholar.ai/OSA1", "openalex")).toBe("openscholar");
    expect(sourceForId("W123", "openalex")).toBe("openalex");
    expect(sourceForId("W123", "openscholar")).toBe("openscholar");
  });

  it("keeps an author's ID on our index as an ID, not a name", () => {
    expect(authorFilterValue("https://openscholar.ai/OSA2259683")).toBe("OSA2259683");
    expect(authorFilterValue("osa2259683")).toBe("OSA2259683");
    expect(isAuthorId("OSA2259683")).toBe(true);
    expect(authorFilterValue("Esther Duflo")).toBe("Esther Duflo");
  });

  it("leaves out the works filter our index refuses on funders and sources", () => {
    expect(autocompleteParameters("nature", "sources", "openscholar")).toEqual({ q: "nature" });
    expect(autocompleteParameters("wellcome", "funders", "openscholar")).toEqual({ q: "wellcome" });
    expect(autocompleteParameters("duflo", "authors", "openscholar")).toEqual({ q: "duflo", filter: "works_count:>0" });
    expect(autocompleteParameters("nature", "sources", "openalex")).toEqual({ q: "nature", filter: "works_count:>0" });
  });
});

describe("sending OQL", () => {
  const sent = () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ meta: { count: 1 }, results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    return () => JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).oql as string;
  };
  afterEach(() => vi.unstubAllGlobals());

  it("writes a query as our index reads it, and leaves OpenAlex's as typed", async () => {
    ownApi();
    const ours = sent();
    await fetchOqlWorks("works where type is article", { perPage: 1 }, "openscholar");
    expect(ours()).toBe("works where type is (article)");
    const theirs = sent();
    await fetchOqlWorks("works where type is article", { perPage: 1 }, "openalex");
    expect(theirs()).toBe("works where type is article");
  });

  it("says how to write a sentence on either source, and asks neither", async () => {
    ownApi();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    for (const source of ["openscholar", "openalex"] as const) {
      const result = await fetchOqlWorks("works where (get works about kelp) and is_retracted is (false)", { perPage: 1 }, source);
      expect(result).toMatchObject({ ok: false, status: 400, detail: { fix: expect.stringContaining("works where") } });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("answers with a failed search, not a thrown error, when our index's address isn't set", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "");
    await expect(fetchOwnWorks({ search: "kelp" }, { perPage: 1 })).resolves.toMatchObject({ ok: false, status: null });
    await expect(fetchOqlWorks("works where year is (2024)", { perPage: 1 }, "openscholar")).resolves.toMatchObject({ ok: false, status: null });
  });

  it("points an error at the query that was sent", async () => {
    ownApi();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ validation: { errors: [{ message: "this field is unknown", position: 12 }] } }), { status: 400 })));
    const result = await fetchOqlWorks("works where nope is value", { perPage: 1 }, "openscholar");
    expect(result).toMatchObject({ ok: false, detail: { problem: "this field is unknown", near: { token: "nope", after: " is (value)" } } });
  });
});
