import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { setupScreeningWorkpool } from "../screening/workpool.test-support";
import { OQL_FIELD } from "../../lib/openalex/oql";
import type { SavedSearch } from "../../lib/research/records";

const search: SavedSearch = {
  id: "local-search", query: "rct... AND tutoring", field: "title_and_abstract", count: 900,
  queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [],
  createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z",
  yearRange: [2015, 2024], filterType: "year", isYearRangeEnabled: true, sortBy: "cited_by_count:desc",
};
const shortcuts = [{ shorthand: "rct", expansion: "randomized controlled trial", createdAt: 1 }];
const job = {
  questions: [{ key: "q1", question: "Is this a trial?" }],
  scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 0, stars: 1 }] },
};

type Request = { url: URL; init?: RequestInit };
let requests: Request[] = [];
/** OpenAlex, answering every page with 200 works numbered from the page's start; a cursor is the next page's number. */
const openAlex = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  requests.push({ url, init });
  const cursor = url.searchParams.get("cursor");
  const page = cursor === null ? Number(url.searchParams.get("page")) : cursor === "*" ? 1 : Number(cursor);
  const start = (page - 1) * 200;
  const results = Array.from({ length: 200 }, (_, i) => ({
    id: `https://openalex.org/W${start + i + 1}`,
    display_name: `Paper ${start + i + 1}`,
    publication_year: 2020,
    abstract_inverted_index: { Tutoring: [0], works: [1] },
    authorships: [{ author: { display_name: "Ada Lovelace" } }],
  }));
  return new Response(JSON.stringify({ meta: { count: 900, next_cursor: String(page + 1) }, results }), { status: 200 });
});

beforeEach(() => {
  requests = [];
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  vi.stubGlobal("fetch", openAlex);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(saved: SavedSearch = search, ratings: Array<{ paperId: string; rating: number }> = []) {
  const t = convexTest(schema);
  setupScreeningWorkpool(t);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "alice", email: "alice@example.com", state: "active", createdAt: 1, updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId: id, free: 100_000 });
    return id;
  });
  const alice = t.withIdentity({ subject: "alice" });
  await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: [{ search: saved }], shortcuts, ratings });
  return { t, userId, alice };
}

describe("Screen all on a saved search, read on the server", () => {
  it("reads the range from the results page's request, one parallel page each, with the key and only the fields it keeps", async () => {
    const { t, alice } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId } = await alice.action(api.screening.start.screenSearch, { searchId: search.id, first: 150, last: 450, ...job });

    expect(requests.map(({ url }) => Number(url.searchParams.get("page"))).sort()).toEqual([1, 2, 3]);
    for (const { url } of requests) {
      expect(url.pathname).toBe("/works");
      expect(url.searchParams.get("api_key")).toBe("platform-key");
      expect(url.searchParams.get("per-page")).toBe("200");
      expect(url.searchParams.get("sort")).toBe("relevance_score:desc");
      expect(url.searchParams.get("select")?.split(",")).toEqual(expect.arrayContaining(["id", "abstract_inverted_index", "authorships"]));
      // The account's shortcut is expanded as the results page expands it, and its year range applies.
      expect(url.searchParams.get("filter")).toContain("randomized controlled trial");
      expect(url.searchParams.get("filter")).toContain("from_publication_date:2015-01-01,to_publication_date:2024-12-31");
    }
    const created = await t.run(async (ctx) => ({
      job: await ctx.db.get("screeningJobs", jobId),
      results: await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(3),
      limits: await ctx.db.query("rateLimits").collect(),
    }));
    expect(created.job?.totalPapers).toBe(301);
    expect(created.results.map((result) => result.openalexId)).toEqual(["W150", "W151", "W152"].map((id) => `https://openalex.org/${id}`));
    expect(created.results[0]).toMatchObject({ title: "Paper 150", abstract: "Tutoring works", authors: ["Ada Lovelace"], publicationYear: 2020 });
    expect(created.limits.find((row) => row.name === "openalex-day")?.value).toBe(20_000 - 3);
  });

  it("reads an explicit sort's cursor pages in order from the start, as the results page lists them", async () => {
    const { t, alice } = await setup();

    const { jobId } = await alice.action(api.screening.start.screenSearch, { searchId: search.id, first: 250, last: 260, ...job });

    expect(requests.map(({ url }) => url.searchParams.get("cursor"))).toEqual(["*", "2"]);
    expect(requests.every(({ url }) => url.searchParams.get("sort") === "cited_by_count:desc" && url.searchParams.get("page") === null)).toBe(true);
    const [firstResult] = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1));
    expect(firstResult?.openalexId).toBe("https://openalex.org/W250");
  });

  it("filters by the days picked, whatever the server's timezone", async () => {
    const { alice } = await setup({ ...search, sortBy: "relevance_score:desc", filterType: "date", isYearRangeEnabled: false, yearRange: undefined, dateRange: { from: "2024-12-31T23:00:00.000Z", to: "2025-01-30T23:00:00.000Z" } });

    await alice.action(api.screening.start.screenSearch, { searchId: search.id, first: 1, last: 5, ...job });

    expect(requests[0]!.url.searchParams.get("filter")).toContain("from_publication_date:2025-01-01,to_publication_date:2025-01-31");
  });

  it("posts an OQL search, and keeps only the papers inside the search's rating filter", async () => {
    const oql: SavedSearch = { ...search, id: "local-oql", query: 'works where title.search has "tutoring"', field: OQL_FIELD, onlyRatedPapers: true, ratingRange: [3, 5] };
    const { t, alice } = await setup(oql, [
      { paperId: "https://openalex.org/W2", rating: 4 },
      { paperId: "https://openalex.org/W5", rating: 1 },
    ]);

    const { jobId } = await alice.action(api.screening.start.screenSearch, { searchId: oql.id, first: 1, last: 10, ...job });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.pathname).toBe("/");
    expect(requests[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]!.init?.body)).oql).toContain("tutoring");
    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
    expect(results.map((result) => result.openalexId)).toEqual(["https://openalex.org/W2"]);
  });

  it("asks OpenAlex nothing once the account's allowance is spent", async () => {
    const { alice } = await setup();
    await alice.mutation(api.openalex.limits.spend, { count: 300 });

    await expect(alice.action(api.screening.start.screenSearch, { searchId: search.id, first: 1, last: 10, ...job })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("refuses another account's search", async () => {
    const { t } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "bob", email: "bob@example.com", state: "active", createdAt: 1, updatedAt: 1 }));

    await expect(t.withIdentity({ subject: "bob" }).action(api.screening.start.screenSearch, { searchId: search.id, first: 1, last: 10, ...job })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect(requests).toHaveLength(0);
  });
});
