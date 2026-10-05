import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { setupScreeningWorkpool } from "../screening/workpool.test-support";
import { screeningPool } from "../workpool";
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
/** How many works the search has. */
let total = 900;
/** Answers OpenAlex gives its next requests in place of works. */
let refusals: Response[] = [];
const instances: ReturnType<typeof convexTest>[] = [];
const maxParallelism = screeningPool.options.maxParallelism;
/** OpenAlex, answering each page with up to 200 works numbered from the page's start, until the search runs out; a cursor is the next page's number. */
const openAlex = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname !== "api.openalex.org") throw new Error(`Unexpected request to ${url.hostname}`);
  if (refusals.length) return refusals.shift()!;
  requests.push({ url, init });
  const cursor = url.searchParams.get("cursor");
  const page = cursor === null ? Number(url.searchParams.get("page")) : cursor === "*" ? 1 : Number(cursor);
  const start = (page - 1) * 200;
  const results = Array.from({ length: Math.max(0, Math.min(200, total - start)) }, (_, i) => ({
    id: `https://openalex.org/W${start + i + 1}`,
    display_name: `Paper ${start + i + 1}`,
    publication_year: 2020,
    abstract_inverted_index: { Tutoring: [0], works: [1] },
    authorships: [{ author: { display_name: "Ada Lovelace" } }],
  }));
  return new Response(JSON.stringify({ meta: { count: total, next_cursor: results.length === 200 ? String(page + 1) : null }, results }), { status: 200 });
});

beforeEach(() => {
  // Starting a job is under test here; its scheduled screening runs belong to their own tests.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  screeningPool.options.maxParallelism = 0;
  requests = [];
  refusals = [];
  total = 900;
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  vi.stubGlobal("fetch", openAlex);
});
afterEach(async () => {
  try {
    for (const t of instances.splice(0)) await t.finishInProgressScheduledFunctions();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    screeningPool.options.maxParallelism = maxParallelism;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

async function setup(saved: SavedSearch = search, ratings: Array<{ paperId: string; rating: number }> = []) {
  const t = convexTest(schema);
  instances.push(t);
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
  it("reads the range from the results page's request, a numbered page each, with the key and only the fields it keeps", async () => {
    const { t, alice } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 150, last: 450, ...job, saveTo: { kind: "none" } });

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
    expect(created.job?.snapshot).toMatchObject({ request: { sort: "relevance_score:desc" } });
    expect(created.job?.snapshot?.request.filter).toContain("randomized controlled trial");
    expect(created.results.map((result) => result.openalexId)).toEqual(["W150", "W151", "W152"].map((id) => `https://openalex.org/${id}`));
    expect(created.results[0]).toMatchObject({ title: "Paper 150", abstract: "Tutoring works", authors: ["Ada Lovelace"], publicationYear: 2020 });
    expect(created.limits.find((row) => row.name === "openalex-day")?.value).toBe(20_000 - 3);
  });

  it("reads an explicit sort's cursor pages in order from the start, as the results page lists them", async () => {
    const { t, alice } = await setup();

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 250, last: 260, ...job, saveTo: { kind: "none" } });

    expect(requests.map(({ url }) => url.searchParams.get("cursor"))).toEqual(["*", "2"]);
    expect(requests.every(({ url }) => url.searchParams.get("sort") === "cited_by_count:desc" && url.searchParams.get("page") === null)).toBe(true);
    const [firstResult] = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1));
    expect(firstResult?.openalexId).toBe("https://openalex.org/W250");
  });

  it("keeps exactly the range asked for when it runs across cursor pages", async () => {
    const { t, alice } = await setup();

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 190, last: 410, ...job, saveTo: { kind: "none" } });

    expect(requests.map(({ url }) => url.searchParams.get("cursor"))).toEqual(["*", "2", "3"]);
    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(300));
    expect(results.map((result) => result.openalexId)).toEqual(Array.from({ length: 221 }, (_, i) => `https://openalex.org/W${190 + i}`));
  });

  it("filters by the days picked, whatever the server's timezone", async () => {
    const { alice } = await setup({ ...search, sortBy: "relevance_score:desc", filterType: "date", isYearRangeEnabled: false, yearRange: undefined, dateRange: { from: "2024-12-31T23:00:00.000Z", to: "2025-01-30T23:00:00.000Z" } });

    await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 5, ...job, saveTo: { kind: "none" } });

    expect(requests[0]!.url.searchParams.get("filter")).toContain("from_publication_date:2025-01-01,to_publication_date:2025-01-31");
  });

  it("posts an OQL search, and keeps only the papers inside the search's rating filter", async () => {
    const oql: SavedSearch = { ...search, id: "local-oql", query: 'works where title.search has "tutoring"', field: OQL_FIELD, onlyRatedPapers: true, ratingRange: [3, 5] };
    const { t, alice } = await setup(oql, [
      { paperId: "https://openalex.org/W2", rating: 4 },
      { paperId: "https://openalex.org/W5", rating: 1 },
    ]);

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: oql.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } });

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

    await expect(alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("says why OpenAlex won't take a search, and keeps a failing server's answer to itself", async () => {
    const { alice } = await setup();
    const start = () => alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } });

    refusals = [new Response(JSON.stringify({ error: "Invalid query parameters error.", message: "Wildcards (* or ?) do not work inside this quoted phrase." }), { status: 400 })];
    await expect(start()).rejects.toThrow(/Wildcards \(\* or \?\) do not work inside this quoted phrase/);

    // An OQL search's reason is in its validation errors.
    refusals = [new Response(JSON.stringify({ validation: { valid: false, errors: [{ type: "parse_error", message: "expected a condition" }] } }), { status: 400 })];
    await expect(start()).rejects.toThrow(/expected a condition/);

    refusals = [new Response(JSON.stringify({ message: "upstream connect error" }), { status: 503 })];
    await expect(start()).rejects.toThrow(/^(?!.*upstream connect error).*503/s);
  });

  it("names the query when OpenAlex fails on a bracket without its pair", async () => {
    const { alice } = await setup({ ...search, query: "(tutoring OR tutor" });

    refusals = [new Response("<!doctype html><title>500 Internal Server Error</title>", { status: 500 })];
    await expect(alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/brackets/);

    // A bracket inside a quoted phrase isn't one: that failure is the server's, and asking again may work.
    const { alice: quoting } = await setup({ ...search, id: "local-quoted", query: '"phase (one" AND tutoring' });
    refusals = [new Response("<!doctype html><title>500 Internal Server Error</title>", { status: 500 })];
    await expect(quoting.action(api.screening.start.screen, { set: { kind: "search", searchId: "local-quoted" }, first: 1, last: 10, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/^(?!.*brackets).*500/s);
  });

  it("asks again for pages OpenAlex throttles, and gives up on a wait no retry outlasts", async () => {
    const { t, alice } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const start = (last: number) => alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last, ...job, saveTo: { kind: "none" } });
    const throttled = (wait: string) => new Response(JSON.stringify({ error: "Rate limit exceeded", reason: "broad_boolean_query" }), { status: 429, headers: { "Retry-After": wait } });

    refusals = [throttled("0"), throttled("0")];
    const { jobId } = await start(450);
    expect((await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))?.totalPapers).toBe(450);

    // The day's budget: OpenAlex says to wait until it resets.
    refusals = [throttled("57776"), throttled("0")];
    await expect(start(10)).rejects.toThrow(/429/);
    // It wasn't asked again: the answer after it is still waiting.
    expect(refusals).toHaveLength(1);
  });

  it("ends a request where the search's results end, however far it was asked to go", async () => {
    const { t, alice } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 801, last: 1_000_000, ...job, saveTo: { kind: "none" } });

    const made = await t.run((ctx) => ctx.db.get("screeningJobs", jobId));
    expect(made).toMatchObject({ totalPapers: 100, first: 801, last: 1_800 });
    // Nothing follows this job: no end of the request to reach, and no papers past the search's last.
    expect(made?.through).toBeUndefined();
    expect(made?.snapshot).toMatchObject({ request: { sort: "relevance_score:desc" } });
    await expect(alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1_001, last: 1_000_000, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/None of these papers/);
    expect(requests.length).toBeLessThan(15);
  });

  it("reads a request's later papers from the search as it was when the request began", async () => {
    total = 2_500;
    const { t, alice } = await setup();
    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 2_500, ...job, saveTo: { kind: "none" } });
    expect(await t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ first: 1, last: 1_000, through: 2_500, snapshot: { request: { sort: "cited_by_count:desc" } } });

    // The search is edited while its first job runs; the job after it reads the search as it was.
    await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "edit", command: { kind: "editSearch", id: search.id, edit: { kind: "patch", fields: { sortBy: "publication_date:desc", query: "something else" }, clear: [] } } });
    await t.run((ctx) => ctx.db.patch("screeningJobs", jobId, { status: "completed" }));
    requests = [];
    await t.action(internal.screening.start.next, { jobId, first: 1_001 });

    expect(requests.length).toBeGreaterThan(0);
    for (const { url } of requests) {
      expect(url.searchParams.get("sort")).toBe("cited_by_count:desc");
      expect(url.searchParams.get("filter")).toContain("randomized controlled trial");
    }
    const jobs = await t.run((ctx) => ctx.db.query("screeningJobs").order("asc").take(5));
    expect(jobs[1]).toMatchObject({ first: 1_001, last: 2_000, through: 2_500, totalPapers: 1_000, snapshot: { request: { sort: "cited_by_count:desc" } } });
  });

  it("refuses another account's search", async () => {
    const { t } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "bob", email: "bob@example.com", state: "active", createdAt: 1, updatedAt: 1 }));

    await expect(t.withIdentity({ subject: "bob" }).action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect(requests).toHaveLength(0);
  });
});

describe("counting OpenAlex requests from an action", () => {
  it("tries again when calls made at once collide on the counter, and gives up on anything else", async () => {
    const { spender } = await import("./search");
    const collision = new Error('Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.');
    // Two collisions, then it counts: the caller never sees them.
    const runMutation = vi.fn().mockRejectedValueOnce(collision).mockRejectedValueOnce(collision).mockResolvedValueOnce(true);
    const spending = spender({ runMutation } as never, "clerk_1")(3);
    await vi.runAllTimersAsync();
    expect(await spending).toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(3);
    expect(runMutation.mock.calls[2][1]).toEqual({ clerkId: "clerk_1", count: 3 });
    // An allowance that's used up is an answer, not a collision.
    expect(await spender({ runMutation: vi.fn().mockResolvedValue(false) } as never, "clerk_1")(1)).toBe(false);
    // Any other failure is the caller's to hear about, at once.
    const broken = vi.fn().mockRejectedValue(new Error("Authentication required"));
    await expect(spender({ runMutation: broken } as never, "clerk_1")(1)).rejects.toThrow(/Authentication required/);
    expect(broken).toHaveBeenCalledTimes(1);
    // A counter that never frees up fails after a bounded number of tries.
    const stuck = vi.fn().mockRejectedValue(collision);
    const rejected = expect(spender({ runMutation: stuck } as never, "clerk_1")(1)).rejects.toThrow(/changed while this mutation/);
    await vi.runAllTimersAsync();
    await rejected;
    expect(stuck).toHaveBeenCalledTimes(6);
  }, 20_000);
});
