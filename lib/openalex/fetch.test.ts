import { afterEach, describe, expect, it, vi } from "vitest";
import { openAlexFetch } from "./fetch";

describe("openAlexFetch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function sent(fetch: ReturnType<typeof vi.spyOn>) {
    const init = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    return Object.fromEntries(new Headers(init?.headers).entries());
  }

  it("sends the OpenScholar API Access's service token, beside the request's own headers", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
    vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_ID", "client-id.access");
    vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_SECRET", "client-secret");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await openAlexFetch("https://search-api.example.org/works?search=kelp", { headers: { "Content-Type": "application/json" } });
    expect(sent(fetch)).toEqual({
      "cf-access-client-id": "client-id.access",
      "cf-access-client-secret": "client-secret",
      "content-type": "application/json",
    });
  });

  it("sends OpenAlex no token", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
    vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_ID", "client-id.access");
    vi.stubEnv("OPENSCHOLAR_API_ACCESS_CLIENT_SECRET", "client-secret");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await openAlexFetch("https://api.openalex.org/works?search=kelp");
    expect(sent(fetch)).toEqual({});
  });
});
