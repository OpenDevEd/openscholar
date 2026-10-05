import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWork } from "./openalex";

type Sent = { url: URL; init?: RequestInit };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    sent.push({ url: new URL(String(input)), init });
    return new Response(JSON.stringify({ id: "https://openalex.org/W7" }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** The OpenScholar API, set with its key and Access's service token. */
function useOpenScholarApi() {
  vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
  vi.stubEnv("OPENSCHOLAR_API_KEY", "osk_test");
  vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_ID", "client-id.access");
  vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_SECRET", "client-secret");
}

const allowed = async () => true;

describe("readWork", () => {
  it("reads one work from the OpenScholar API with Access's service token, following none of its redirects", async () => {
    useOpenScholarApi();

    expect(await readWork("W7", "id", allowed)).toEqual({ id: "https://openalex.org/W7" });

    expect(sent.map(({ url }) => `${url.origin}${url.pathname}`)).toEqual(["https://search-api.example.org/works/W7"]);
    expect(Object.fromEntries(new Headers(sent[0]?.init?.headers).entries())).toEqual({
      "cf-access-client-id": "client-id.access",
      "cf-access-client-secret": "client-secret",
    });
    expect(sent[0]?.init?.redirect).toBe("manual");
  });
});
