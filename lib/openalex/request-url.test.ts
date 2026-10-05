import { afterEach, describe, expect, it, vi } from "vitest";
import { openAlexHeaders, openAlexUrl } from "./request-url";

function withKeys(openScholarApi: string) {
  vi.stubEnv("OPENSCHOLAR_API_URL", openScholarApi);
  vi.stubEnv("OPENSCHOLAR_API_KEY", openScholarApi ? "osk_test" : "");
  vi.stubEnv("OPENALEX_API_KEY", "openalex-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "team@example.org");
}

describe("openAlexUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("asks OpenAlex, with its key and contact email, when no OpenScholar API is set", () => {
    withKeys("");
    const url = openAlexUrl("works", { filter: "type:article" });
    expect(url.origin + url.pathname).toBe("https://api.openalex.org/works");
    expect(Object.fromEntries(url.searchParams)).toEqual({ filter: "type:article", api_key: "openalex-key", mailto: "team@example.org" });
  });

  it("asks the OpenScholar API for works and OQL, with its own key and no email", () => {
    withKeys("http://127.0.0.1:8801");
    const asked = ["works", "/works?&filter=type:article", "works/W2741809807", "works/doi:10.1/x", ""].map((path) => {
      const url = openAlexUrl(path, { "per-page": "1" });
      return [url.origin, url.pathname, url.searchParams.get("api_key"), url.searchParams.get("mailto")];
    });
    expect(asked).toEqual([
      ["http://127.0.0.1:8801", "/works", "osk_test", null],
      ["http://127.0.0.1:8801", "/works", "osk_test", null],
      ["http://127.0.0.1:8801", "/works/W2741809807", "osk_test", null],
      ["http://127.0.0.1:8801", "/works/doi:10.1/x", "osk_test", null],
      ["http://127.0.0.1:8801", "/", "osk_test", null],
    ]);
  });

  it("keeps the path in the OpenScholar API's address", () => {
    withKeys("https://api.example.org/openscholar");
    expect(openAlexUrl("/works?&filter=type:article").href).toBe("https://api.example.org/openscholar/works?filter=type%3Aarticle&api_key=osk_test");
  });

  it("still asks OpenAlex for authors, funders and topics, which it alone serves", () => {
    withKeys("http://127.0.0.1:8801");
    const asked = ["authors", "funders", "autocomplete/funders", "topics/T10017", "worksheets"].map((path) => {
      const url = openAlexUrl(path);
      return [url.origin, url.searchParams.get("api_key"), url.searchParams.get("mailto")];
    });
    expect(asked).toEqual(Array(5).fill(["https://api.openalex.org", "openalex-key", "team@example.org"]));
  });
});

describe("openAlexHeaders", () => {
  afterEach(() => vi.unstubAllEnvs());

  function withToken(openScholarApi: string, id: string, secret: string) {
    vi.stubEnv("OPENSCHOLAR_API_URL", openScholarApi);
    vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_ID", id);
    vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_SECRET", secret);
  }

  it("gives the OpenScholar API's requests Cloudflare Access's service token", () => {
    withToken("https://search-api.example.org", "client-id.access", "client-secret");
    expect(openAlexHeaders(openAlexUrl("works", { search: "kelp" }))).toEqual({
      "CF-Access-Client-Id": "client-id.access",
      "CF-Access-Client-Secret": "client-secret",
    });
    expect(openAlexHeaders("https://search-api.example.org/")).toEqual({
      "CF-Access-Client-Id": "client-id.access",
      "CF-Access-Client-Secret": "client-secret",
    });
  });

  it("never gives the token to OpenAlex, nor sends a token that is not set", () => {
    withToken("https://search-api.example.org", "client-id.access", "client-secret");
    expect(openAlexHeaders(openAlexUrl("topics/T10745"))).toEqual({});
    expect(openAlexHeaders("https://api.openalex.org/works")).toEqual({});
    withToken("https://search-api.example.org", "", "");
    expect(openAlexHeaders(openAlexUrl("works"))).toEqual({});
    withToken("", "client-id.access", "client-secret");
    expect(openAlexHeaders(openAlexUrl("works"))).toEqual({});
  });
});

