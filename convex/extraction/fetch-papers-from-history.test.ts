import { afterEach, expect, it, vi } from "vitest";
import { runFetchPapersFromHistory } from "./actions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("refuses a search saved before its exact request was kept, without asking OpenAlex", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(
    runFetchPapersFromHistory({ query: "heart disease", selectedCountryFocus: ["KE"], limit: 2 }),
  ).rejects.toThrow(/Add it again/);
  expect(request).not.toHaveBeenCalled();
});

// Chat and extraction run here on the shared server. Without the key every
// search they run costs 10 of 1,000 daily credits shared by all of them.
it("sends OpenScholar's OpenAlex key with the stored search", async () => {
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  const request = vi.fn(async () => Response.json({ meta: { count: 0 }, results: [] }));
  vi.stubGlobal("fetch", request);
  await runFetchPapersFromHistory({
    query: "tutor",
    openAlexQuery: { filter: "title_and_abstract.search:tutor", sort: "relevance_score:desc" },
    limit: 5,
  });
  const url = new URL(String((request.mock.calls[0] as unknown[])[0]));
  expect(url.searchParams.get("api_key")).toBe("platform-key");
});
