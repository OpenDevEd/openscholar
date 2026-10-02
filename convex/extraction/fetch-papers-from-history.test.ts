import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

let requests: URL[] = [];
/** OpenAlex, answering every numbered page with 200 works numbered from its start. */
const openAlex = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  requests.push(url);
  const start = (Number(url.searchParams.get("page")) - 1) * 200;
  const results = Array.from({ length: 200 }, (_, i) => ({ id: `https://openalex.org/W${start + i + 1}`, display_name: `Paper ${start + i + 1}` }));
  return Response.json({ meta: { count: 900 }, results });
});

beforeEach(() => {
  requests = [];
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  vi.stubGlobal("fetch", openAlex);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema);
  const userId = await t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "ada", email: "ada@test", state: "active", createdAt: 1, updatedAt: 1 }));
  return { t, userId };
}

it("refuses a search saved before its exact request was kept, without asking OpenAlex", async () => {
  const { t, userId } = await setup();
  await expect(
    t.action(internal.extraction.actions.fetchPapersFromHistory, { userId, searchFilters: { query: "heart disease", selectedCountryFocus: ["KE"], limit: 2 } }),
  ).rejects.toThrow(/Add it again/);
  expect(requests).toHaveLength(0);
});

// Chat and extraction read the stored search on the shared server: with OpenScholar's key,
// past the single page they used to stop at, and counted against the person's allowance.
it("reads the chosen number of papers across pages with OpenScholar's key, spending the person's allowance", async () => {
  const { t, userId } = await setup();

  const papers = await t.action(internal.extraction.actions.fetchPapersFromHistory, {
    userId,
    searchFilters: { query: "tutor", openAlexQuery: { filter: "title_and_abstract.search:tutor", sort: "relevance_score:desc" }, limit: 450 },
  });

  expect(papers).toHaveLength(450);
  expect(papers.at(-1)?.openalexId).toBe("W450");
  expect(requests.map((url) => url.searchParams.get("page")).sort()).toEqual(["1", "2", "3"]);
  expect(requests.every((url) => url.searchParams.get("api_key") === "platform-key" && url.searchParams.get("filter") === "title_and_abstract.search:tutor")).toBe(true);
  const day = await t.run(async (ctx) => (await ctx.db.query("rateLimits").collect()).find((row) => row.name === "openalex-day"));
  expect(day?.value).toBe(20_000 - 3);
});

it("spends one request per cursor page actually read, so a search that runs out early isn't charged its whole limit", async () => {
  const { t, userId } = await setup();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    requests.push(new URL(String(input)));
    return Response.json({ meta: { count: 50, next_cursor: null }, results: Array.from({ length: 50 }, (_, i) => ({ id: `https://openalex.org/W${i + 1}`, display_name: `Paper ${i + 1}` })) });
  }));

  const papers = await t.action(internal.extraction.actions.fetchPapersFromHistory, {
    userId,
    searchFilters: { query: "tutor", openAlexQuery: { filter: "title_and_abstract.search:tutor", sort: "cited_by_count:desc" }, limit: 1000 },
  });

  expect(papers).toHaveLength(50);
  expect(requests).toHaveLength(1);
  const day = await t.run(async (ctx) => (await ctx.db.query("rateLimits").collect()).find((row) => row.name === "openalex-day"));
  expect(day?.value).toBe(20_000 - 1);
});
