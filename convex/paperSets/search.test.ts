import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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
/** How many works the search has. */
let total = 900;
/** OpenAlex, answering each page with up to 200 works numbered from the page's start, until the search runs out; a cursor is the next page's number. */
const openAlex = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
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
  requests = [];
  total = 900;
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  vi.stubGlobal("fetch", openAlex);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(saved: SavedSearch = search, ratings: Array<{ paperId: string; rating: number }> = [], credits = 100_000) {
  const t = convexTest(schema);
  setupScreeningWorkpool(t);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "alice", email: "alice@example.com", state: "active", createdAt: 1, updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId: id, free: credits });
    return id;
  });
  const alice = t.withIdentity({ subject: "alice" });
  await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: [{ search: saved }], shortcuts, ratings });
  const read = (jobId: Id<"screeningJobs">) => t.run((ctx) => ctx.db.get("screeningJobs", jobId));
  /** The job once the reading of its papers, which follows its start, is over. */
  const settled = (jobId: Id<"screeningJobs">) =>
    vi.waitFor(async () => {
      const made = (await read(jobId))!;
      expect(made.reading).toBeUndefined();
      return made;
    }, { timeout: 10_000, interval: 20 });
  /** Starts a job as Alice and waits for its papers. */
  const screen = async (args: { searchId?: string; first: number; last: number }) => {
    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: args.searchId ?? search.id }, first: args.first, last: args.last, ...job, saveTo: { kind: "none" } });
    return { jobId, made: await settled(jobId) };
  };
  return { t, userId, alice, read, settled, screen };
}

/** The requests made to OpenAlex, which the model's requests share a stub with. */
const asked = () => requests.filter(({ url }) => url.hostname === "api.openalex.org");
/** Those for the search's papers: the one that counts the search before the job is made asks for a single work. */
const pages = () => asked().filter(({ url }) => url.searchParams.get("per-page") === "200");

describe("Screen all on a saved search, read on the server", () => {
  it("reads the range from the results page's request, a numbered page each, with the key and only the fields it keeps", async () => {
    const { t, alice, read, settled } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 150, last: 450, ...job, saveTo: { kind: "none" } });

    // The job is there before its papers: nobody waits for OpenAlex to see it.
    expect(await read(jobId)).toMatchObject({ status: "processing", reading: true, totalPapers: 301, first: 150, last: 450 });
    await settled(jobId);

    expect(pages().map(({ url }) => Number(url.searchParams.get("page"))).sort()).toEqual([1, 2, 3]);
    for (const { url } of pages()) expect(url.searchParams.get("select")?.split(",")).toEqual(expect.arrayContaining(["id", "abstract_inverted_index", "authorships"]));
    for (const { url } of asked()) {
      expect(url.pathname).toBe("/works");
      expect(url.searchParams.get("api_key")).toBe("platform-key");
      expect(url.searchParams.get("sort")).toBe("relevance_score:desc");
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
    // A request to count the search, and one for each page.
    expect(created.limits.find((row) => row.name === "openalex-day")?.value).toBe(20_000 - 4);
  });

  it("reads an explicit sort's cursor pages in order from the start, as the results page lists them", async () => {
    const { t, screen } = await setup();

    const { jobId } = await screen({ first: 250, last: 260 });

    expect(pages().map(({ url }) => url.searchParams.get("cursor"))).toEqual(["*", "2"]);
    expect(pages().every(({ url }) => url.searchParams.get("sort") === "cited_by_count:desc" && url.searchParams.get("page") === null)).toBe(true);
    const [firstResult] = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1));
    expect(firstResult?.openalexId).toBe("https://openalex.org/W250");
  });

  it("keeps exactly the range asked for when it runs across cursor pages", async () => {
    const { t, screen } = await setup();

    const { jobId } = await screen({ first: 190, last: 410 });

    expect(pages().map(({ url }) => url.searchParams.get("cursor"))).toEqual(["*", "2", "3"]);
    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(300));
    expect(results.map((result) => result.openalexId)).toEqual(Array.from({ length: 221 }, (_, i) => `https://openalex.org/W${190 + i}`));
  });

  it("filters by the days picked, whatever the server's timezone", async () => {
    const { screen } = await setup({ ...search, sortBy: "relevance_score:desc", filterType: "date", isYearRangeEnabled: false, yearRange: undefined, dateRange: { from: "2024-12-31T23:00:00.000Z", to: "2025-01-30T23:00:00.000Z" } });

    await screen({ first: 1, last: 5 });

    expect(pages()[0]!.url.searchParams.get("filter")).toContain("from_publication_date:2025-01-01,to_publication_date:2025-01-31");
  });

  it("posts an OQL search, and keeps only the papers inside the search's rating filter", async () => {
    const oql: SavedSearch = { ...search, id: "local-oql", query: 'works where title.search has "tutoring"', field: OQL_FIELD, onlyRatedPapers: true, ratingRange: [3, 5] };
    const { t, screen } = await setup(oql, [
      { paperId: "https://openalex.org/W2", rating: 4 },
      { paperId: "https://openalex.org/W5", rating: 1 },
    ]);

    const { jobId } = await screen({ searchId: oql.id, first: 1, last: 10 });

    expect(pages()).toHaveLength(1);
    for (const request of asked()) {
      expect(request.url.pathname).toBe("/");
      expect(request.init?.method).toBe("POST");
      expect(JSON.parse(String(request.init?.body)).oql).toContain("tutoring");
    }
    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
    expect(results.map((result) => result.openalexId)).toEqual(["https://openalex.org/W2"]);
  });

  it("asks OpenAlex nothing once the account's allowance is spent", async () => {
    const { alice } = await setup();
    await alice.mutation(api.openalex.limits.spend, { count: 300 });

    await expect(alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } })).rejects.toThrow();
    expect(asked()).toHaveLength(0);
  });

  it("says why OpenAlex won't take a search, and keeps a failing server's answer to itself", async () => {
    const { alice } = await setup();
    const start = () => alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } });

    openAlex.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Invalid query parameters error.", message: "Wildcards (* or ?) do not work inside this quoted phrase." }), { status: 400 }));
    await expect(start()).rejects.toThrow(/Wildcards \(\* or \?\) do not work inside this quoted phrase/);

    // An OQL search's reason is in its validation errors.
    openAlex.mockResolvedValueOnce(new Response(JSON.stringify({ validation: { valid: false, errors: [{ type: "parse_error", message: "expected a condition" }] } }), { status: 400 }));
    await expect(start()).rejects.toThrow(/expected a condition/);

    openAlex.mockResolvedValueOnce(new Response(JSON.stringify({ message: "upstream connect error" }), { status: 503 }));
    await expect(start()).rejects.toThrow(/^(?!.*upstream connect error).*503/s);
  });

  it("names the query when OpenAlex fails on a bracket without its pair", async () => {
    const { alice } = await setup({ ...search, query: "(tutoring OR tutor" });

    openAlex.mockResolvedValueOnce(new Response("<!doctype html><title>500 Internal Server Error</title>", { status: 500 }));
    await expect(alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/brackets/);

    // A bracket inside a quoted phrase isn't one: that failure is the server's, and asking again may work.
    const { alice: quoting } = await setup({ ...search, id: "local-quoted", query: '"phase (one" AND tutoring' });
    openAlex.mockResolvedValueOnce(new Response("<!doctype html><title>500 Internal Server Error</title>", { status: 500 }));
    await expect(quoting.action(api.screening.start.screen, { set: { kind: "search", searchId: "local-quoted" }, first: 1, last: 10, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/^(?!.*brackets).*500/s);
  });

  it("asks again for pages OpenAlex throttles, and gives up on a wait no retry outlasts", async () => {
    const { alice, settled } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const start = (last: number) => alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last, ...job, saveTo: { kind: "none" } });
    const throttled = (wait: string) => new Response(JSON.stringify({ error: "Rate limit exceeded", reason: "broad_boolean_query" }), { status: 429, headers: { "Retry-After": wait } });

    // The count, then two of the pages.
    openAlex.mockResolvedValueOnce(throttled("0"));
    const { jobId } = await start(450);
    openAlex.mockResolvedValueOnce(throttled("0")).mockResolvedValueOnce(throttled("0"));
    expect(await settled(jobId)).toMatchObject({ status: "processing", totalPapers: 450 });

    // The day's budget: OpenAlex says to wait until it resets.
    const asked = openAlex.mock.calls.length;
    openAlex.mockResolvedValueOnce(throttled("57776"));
    await expect(start(10)).rejects.toThrow(/429/);
    expect(openAlex.mock.calls.length).toBe(asked + 1);
  });

  it("ends a request where the search's results end, however far it was asked to go", async () => {
    const { alice, screen } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { made } = await screen({ first: 801, last: 1_000_000 });

    expect(made).toMatchObject({ totalPapers: 100, first: 801, last: 900 });
    // Nothing follows this job: no end of the request to reach, and no papers past the search's last.
    expect(made.through).toBeUndefined();
    expect(made.snapshot).toMatchObject({ request: { sort: "relevance_score:desc" } });
    // Only the page that holds the search's last papers was asked for.
    expect(pages().map(({ url }) => url.searchParams.get("page"))).toEqual(["5"]);
    await expect(alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1_001, last: 1_000_000, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/no papers in that range/);
  });

  it("reads a request's later papers from the search as it was when the request began", async () => {
    total = 2_500;
    const { t, alice, screen } = await setup();
    const { jobId, made } = await screen({ first: 1, last: 2_500 });
    expect(made).toMatchObject({ first: 1, last: 1_000, through: 2_500, snapshot: { request: { sort: "cited_by_count:desc" } } });

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

  it("ends a job as failed, with why, when its papers can't be read", async () => {
    const { alice, settled } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const start = () => alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } });

    // The search counted, and then OpenAlex fails on its papers.
    const failing = await start();
    openAlex.mockResolvedValueOnce(new Response(JSON.stringify({ message: "upstream connect error" }), { status: 503 }));
    expect(await settled(failing.jobId)).toMatchObject({ status: "failed", failure: expect.stringMatching(/503/) });

    // Every paper is outside the search's rating filter.
    const { alice: rater, settled: rated } = await setup({ ...search, id: "local-rated", onlyRatedPapers: true, ratingRange: [3, 5] });
    const empty = await rater.action(api.screening.start.screen, { set: { kind: "search", searchId: "local-rated" }, first: 1, last: 10, ...job, saveTo: { kind: "none" } });
    expect(await rated(empty.jobId)).toMatchObject({ status: "failed", failure: expect.stringMatching(/rating filter/) });
  });

  it("leaves a job cancelled while its papers were read without them", async () => {
    const { t, alice, read } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 450, ...job, saveTo: { kind: "none" } });
    await alice.mutation(api.screening.mutations.cancelScreeningJob, { jobId });
    await vi.waitFor(() => expect(pages()).toHaveLength(3), { timeout: 10_000, interval: 20 });
    await t.finishInProgressScheduledFunctions();

    expect((await read(jobId))?.status).toBe("cancelled");
    expect(await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1))).toHaveLength(0);
  });

  it("keeps a job the person can't pay for once its papers are counted, out of credits", async () => {
    const { t, screen } = await setup(search, [], 5);

    const { jobId, made } = await screen({ first: 1, last: 10 });

    expect(made).toMatchObject({ status: "creditsExhausted", totalPapers: 10 });
    expect(await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1))).toHaveLength(0);
  });

  it("refuses another account's search", async () => {
    const { t } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "bob", email: "bob@example.com", state: "active", createdAt: 1, updatedAt: 1 }));

    await expect(t.withIdentity({ subject: "bob" }).action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect(asked()).toHaveLength(0);
  });
});

describe("counting OpenAlex requests from an action", () => {
  it("tries again when calls made at once collide on the counter, and gives up on anything else", async () => {
    const { spender } = await import("./search");
    const collision = new Error('Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.');
    // Two collisions, then it counts: the caller never sees them.
    const runMutation = vi.fn().mockRejectedValueOnce(collision).mockRejectedValueOnce(collision).mockResolvedValueOnce(true);
    expect(await spender({ runMutation } as never, "clerk_1")(3)).toBe(true);
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
    await expect(spender({ runMutation: stuck } as never, "clerk_1")(1)).rejects.toThrow(/changed while this mutation/);
    expect(stuck).toHaveBeenCalledTimes(6);
  }, 20_000);
});
