import { convexTest } from "convex-test";
import { pageIdOf, toPaperKey } from "../../lib/papers/paper-ref";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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
  scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], minimumScore: 1, starThresholds: [{ minScore: 0, stars: 1 }] },
};

type Request = { url: URL; init?: RequestInit };
let requests: Request[] = [];
/** How many works the search has. */
let total = 900;
/** Answers OpenAlex gives its next requests in place of works. */
let refusals: Response[] = [];
const instances: ReturnType<typeof convexTest>[] = [];
const maxParallelism = screeningPool.options.maxParallelism;
/** OpenAlex's pages of papers wait for this before they answer. */
let held: Promise<void> | undefined;
let releaseHeld: (() => void) | undefined;
/** OpenAlex, answering each page with up to 200 works numbered from the page's start, until the search runs out; a cursor is the next page's number. */
const openAlex = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname !== "api.openalex.org") throw new Error(`Unexpected request to ${url.hostname}`);
  if (refusals.length) return refusals.shift()!;
  requests.push({ url, init });
  if (url.searchParams.get("per-page") === "200") await held;
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
  held = undefined;
  releaseHeld = undefined;
  total = 900;
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
  vi.stubGlobal("fetch", openAlex);
});
afterEach(async () => {
  try {
    releaseHeld?.();
    for (const t of instances.splice(0)) await t.finishInProgressScheduledFunctions();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    screeningPool.options.maxParallelism = maxParallelism;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

async function setup(saved: SavedSearch = search, ratings: Array<{ paperId: string; rating: number }> = [], credits = 100_000) {
  const t = convexTest(schema);
  instances.push(t);
  setupScreeningWorkpool(t);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { clerkId: "alice", email: "alice@example.com", state: "active", createdAt: 1, updatedAt: 1 });
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

/** Waits until no reading of a job's papers is scheduled or running. */
const readsOver = (t: ReturnType<typeof convexTest>) =>
  vi.waitFor(async () => expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()).then((rows) => rows.filter((row) => row.name.includes("start:read") && row.state.kind !== "success" && row.state.kind !== "failed"))).toHaveLength(0), { timeout: 10_000, interval: 50 });

/** Those for the search's papers: the one that counts the search before the job is made asks for a single work. */
const pages = () => requests.filter(({ url }) => url.searchParams.get("per-page") === "200");

describe("Screen all with our own index as the active source", () => {
  it("reads our index with its key, keeps the OpenAlex ID where there is one, and stays on our index once the job has begun", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search.test");
    vi.stubEnv("OPENSCHOLAR_API_KEY", "own-key");
    const asked: Array<{ url: URL; authorization: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname !== "search.test") throw new Error(`Unexpected request to ${url.hostname}`);
      asked.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      const results = url.searchParams.get("per-page") === "1"
        ? [{ id: "https://openscholar.ai/OS1", ids: {} }]
        : [
            { id: "https://openscholar.ai/OS1", ids: { openalex: "https://openalex.org/W7" }, display_name: "Known to OpenAlex" },
            { id: "https://openscholar.ai/OS2", ids: {}, display_name: "Only in our index" },
          ];
      return new Response(JSON.stringify({ meta: { count: 2, next_cursor: null }, results }), { status: 200 });
    }));
    const { t, screen } = await setup({ ...search, sortBy: "relevance_score:desc" });
    await t.run((ctx) => ctx.db.insert("featureFlags", { key: "search.openscholar", enabled: true, updatedAt: 1 }));

    const { jobId, made } = await screen({ first: 1, last: 2 });

    expect(made.snapshot?.request.source).toBe("openscholar");
    for (const request of asked) {
      expect(request.authorization).toBe("Bearer own-key");
      expect(request.url.searchParams.get("api_key")).toBeNull();
    }
    // What decides a paper's ID has to be read back even when the job asks for fewer fields.
    expect(asked.find(({ url }) => url.searchParams.get("per-page") === "200")?.url.searchParams.get("select")?.split(",")).toContain("ids");
    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(3));
    expect(results.map((result) => result.paperKey).sort()).toEqual(["openalex:W7", "openscholar:OS2"]);
  });
});

describe("Screen all on a search only our index has", () => {
  const answering = (asked: URL[]) => vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    asked.push(url);
    return new Response(JSON.stringify({ meta: { count: 1, next_cursor: null }, results: [{ id: "https://openalex.org/W7", display_name: "Paper" }] }), { status: 200 });
  });

  it("asks our index the question, or for the similar papers, with nothing else in their place", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search.test");
    const asked: URL[] = [];
    vi.stubGlobal("fetch", answering(asked));
    const { t, screen } = await setup({ ...search, field: "semantic", query: "What helps teachers stay?", sortBy: "relevance_score:desc" });
    await t.run((ctx) => ctx.db.insert("featureFlags", { key: "search.openscholar", enabled: true, updatedAt: 1 }));
    await screen({ first: 1, last: 1 });
    const read = asked.at(-1)!;
    expect(read.searchParams.get("search.semantic")).toBe("What helps teachers stay?");
    expect(read.searchParams.get("search")).toBeNull();
  });

  it("reads a question as words on OpenAlex, and says similar papers need our index", async () => {
    const asked: URL[] = [];
    vi.stubGlobal("fetch", answering(asked));
    const { screen } = await setup({ ...search, field: "semantic", query: "teachers", sortBy: "relevance_score:desc" });
    await screen({ first: 1, last: 1 });
    expect(asked.at(-1)!.searchParams.get("search.semantic")).toBeNull();
    expect(asked.at(-1)!.searchParams.get("filter")).toContain("title_and_abstract.search:teachers");

    const { screen: similar } = await setup({ ...search, query: "", similarTo: ["W1"], sortBy: "relevance_score:desc" });
    await expect(similar({ first: 1, last: 1 })).rejects.toThrow(/our own index/);
  });
});

describe("Screen all on a saved search, read on the server", () => {
  it("reads the range from the results page's request, a numbered page each, with the key and only the fields it keeps", async () => {
    const { t, alice, read, settled } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 150, last: 450, ...job, saveTo: { kind: "none" } });

    // The job is there before its papers: nobody waits for OpenAlex to see it.
    expect(await read(jobId)).toMatchObject({ status: "processing", reading: true, totalPapers: 301, first: 150, last: 450 });
    await settled(jobId);

    expect(pages().map(({ url }) => Number(url.searchParams.get("page"))).sort()).toEqual([1, 2, 3]);
    for (const { url } of pages()) expect(url.searchParams.get("select")?.split(",")).toEqual(expect.arrayContaining(["id", "abstract_inverted_index", "authorships"]));
    for (const { url } of requests) {
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
    expect(created.results.map((result) => pageIdOf(result))).toEqual(["W150", "W151", "W152"].map((id) => `https://openalex.org/${id}`));
    expect(created.results[0]).toMatchObject({ title: "Paper 150", abstract: "Tutoring works", authors: ["Ada Lovelace"], publicationYear: 2020 });
    // A request to count the search, and one for each page.
    expect(created.limits.find((row) => row.name === "openalex-day")?.value).toBe(20_000 - 4);

    // The check that ends a job whose papers never came leaves this one alone.
    await t.mutation(internal.screening.mutations.failScreeningRead, { jobId, reason: "Its papers took too long to read." });
    expect(await read(jobId)).toMatchObject({ status: "processing", totalPapers: 301 });
  });

  it("reads an explicit sort's cursor pages in order from the start, as the results page lists them", async () => {
    const { t, screen } = await setup();

    const { jobId } = await screen({ first: 250, last: 260 });

    expect(pages().map(({ url }) => url.searchParams.get("cursor"))).toEqual(["*", "2"]);
    expect(pages().every(({ url }) => url.searchParams.get("sort") === "cited_by_count:desc" && url.searchParams.get("page") === null)).toBe(true);
    const [firstResult] = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1));
    expect(firstResult && pageIdOf(firstResult)).toBe("https://openalex.org/W250");
  });

  it("keeps exactly the range asked for when it runs across cursor pages", async () => {
    const { t, screen } = await setup();

    const { jobId } = await screen({ first: 190, last: 410 });

    expect(pages().map(({ url }) => url.searchParams.get("cursor"))).toEqual(["*", "2", "3"]);
    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(300));
    expect(results.map((result) => pageIdOf(result))).toEqual(Array.from({ length: 221 }, (_, i) => `https://openalex.org/W${190 + i}`));
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
    for (const request of requests) {
      expect(request.url.pathname).toBe("/");
      expect(request.init?.method).toBe("POST");
      expect(JSON.parse(String(request.init?.body)).oql).toContain("tutoring");
    }
    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
    expect(results.map((result) => pageIdOf(result))).toEqual(["https://openalex.org/W2"]);
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
    const { alice, settled } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const start = (last: number) => alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last, ...job, saveTo: { kind: "none" } });
    const throttled = (wait: string) => new Response(JSON.stringify({ error: "Rate limit exceeded", reason: "broad_boolean_query" }), { status: 429, headers: { "Retry-After": wait } });

    // The count, then two of the pages.
    refusals = [throttled("0")];
    const { jobId } = await start(450);
    refusals = [throttled("0"), throttled("0")];
    expect(await settled(jobId)).toMatchObject({ status: "processing", totalPapers: 450 });

    // The day's budget: OpenAlex says to wait until it resets.
    refusals = [throttled("57776"), throttled("0")];
    await expect(start(10)).rejects.toThrow(/429/);
    // It wasn't asked again: the answer after it is still waiting.
    expect(refusals).toHaveLength(1);
  });

  it("ends a request where the search's results end, however far it was asked to go", async () => {
    const { alice, screen } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { made } = await screen({ first: 801, last: 90_000 });

    expect(made).toMatchObject({ totalPapers: 100, first: 801, last: 900 });
    // No papers past the search's last.
    expect(made.snapshot).toMatchObject({ request: { sort: "relevance_score:desc" } });
    // Only the page that holds the search's last papers was asked for.
    expect(pages().map(({ url }) => url.searchParams.get("page"))).toEqual(["5"]);
    await expect(alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1_001, last: 90_000, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/no papers in that range/);
  });

  it("reads a long range into one job, each of its pages once, from the search as it was when the job began", { tags: ["size"] }, async () => {
    total = 2_500;
    const { t, screen } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const firstOf = async (jobId: Id<"screeningJobs">) => (await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1)))[0] as Parameters<typeof pageIdOf>[0] | undefined;
    const firstIdOf = async (jobId: Id<"screeningJobs">) => { const first = await firstOf(jobId); return first && pageIdOf(first); };

    const { jobId, made } = await screen({ first: 150, last: 2_400 });
    expect(made).toMatchObject({ first: 150, last: 2_400, totalPapers: 2_251, snapshot: { request: { sort: "relevance_score:desc" } } });
    expect(await firstIdOf(jobId)).toBe("https://openalex.org/W150");
    // Each of OpenAlex's pages asked for once, in order: a step a page.
    expect(pages().map(({ url }) => url.searchParams.get("page"))).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
    for (const { url } of pages()) expect(url.searchParams.get("sort")).toBe("relevance_score:desc");
    const ids = new Set((await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(3_000))).map((result) => pageIdOf(result)));
    expect(ids.size).toBe(2_251);
  });

  it("carries on partway through a cursor page when OpenAlex returns a short one", { tags: ["size"] }, async () => {
    total = 2_500;
    const { t, screen } = await setup();
    const work = (i: number) => ({ id: `https://openalex.org/W${i}`, display_name: `Paper ${i}` });

    // The count's answer, then a first page one work short: the step takes the second page's first work, and the next starts after it.
    refusals = [
      new Response(JSON.stringify({ meta: { count: 2_500 }, results: [work(1)] })),
      new Response(JSON.stringify({ meta: { count: 2_500, next_cursor: "2" }, results: Array.from({ length: 199 }, (_, i) => work(i + 1)) })),
    ];
    const { jobId } = await screen({ first: 1, last: 2_500 });
    const ids = (await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(3_000))).map((result) => pageIdOf(result));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("https://openalex.org/W201");
  });

  it("reads a range past the search's 10,000th paper by cursor throughout, each page once, where OpenAlex has no numbered pages", async () => {
    total = 10_400;
    const { t, screen } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId, made } = await screen({ first: 9_901, last: 10_100 });

    expect(made).toMatchObject({ status: "processing", totalPapers: 200 });
    expect(pages().every(({ url }) => url.searchParams.get("page") === null && url.searchParams.get("cursor") !== null)).toBe(true);
    const cursors = pages().map(({ url }) => url.searchParams.get("cursor"));
    expect(new Set(cursors).size).toBe(cursors.length);
    const ids = (await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(300))).map((result) => pageIdOf(result));
    expect(ids).toEqual(Array.from({ length: 200 }, (_, i) => `https://openalex.org/W${9_901 + i}`));
  });

  it("carries on past a short numbered page, to the search's last paper", { tags: ["size"] }, async () => {
    total = 2_500;
    const { t, screen } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const work = (i: number) => ({ id: `https://openalex.org/W${i}`, display_name: `Paper ${i}` });

    // The count's answer, then a first page one work short.
    refusals = [
      new Response(JSON.stringify({ meta: { count: 2_500 }, results: [work(1)] })),
      new Response(JSON.stringify({ meta: { count: 2_500 }, results: Array.from({ length: 199 }, (_, i) => work(i + 1)) })),
    ];
    const { jobId, made } = await screen({ first: 1, last: 2_500 });

    expect(made.totalPapers).toBe(2_499);
    const last = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job_paperKey", (q) => q.eq("jobId", jobId).eq("paperKey", toPaperKey("https://openalex.org/W2500")!)).unique());
    expect(last).not.toBeNull();
  });

  it("screens a paper OpenAlex lists on two pages once", async () => {
    const { t, screen } = await setup();
    const work = (i: number) => ({ id: `https://openalex.org/W${i}`, display_name: `Paper ${i}` });

    // The count's answer, then two cursor pages that both hold W200.
    refusals = [
      new Response(JSON.stringify({ meta: { count: 600 }, results: [work(1)] })),
      new Response(JSON.stringify({ meta: { count: 600, next_cursor: "2" }, results: Array.from({ length: 200 }, (_, i) => work(i + 1)) })),
      new Response(JSON.stringify({ meta: { count: 600, next_cursor: "3" }, results: Array.from({ length: 200 }, (_, i) => work(i + 200)) })),
    ];
    const { jobId, made } = await screen({ first: 1, last: 600 });

    const ids = (await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(700))).map((result) => pageIdOf(result));
    expect(new Set(ids).size).toBe(ids.length);
    expect(made.totalPapers).toBe(ids.length);
  });

  it("holds a paper OpenAlex returns twice in one read once", async () => {
    const { screen } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const work = (i: number) => ({ id: `https://openalex.org/W${i}`, display_name: `Paper ${i}` });

    // The count's answer, then a page that repeats its first work.
    refusals = [
      new Response(JSON.stringify({ meta: { count: 900 }, results: [work(1)] })),
      new Response(JSON.stringify({ meta: { count: 900 }, results: [work(1), work(2), work(1)] })),
    ];
    const { made } = await screen({ first: 1, last: 3 });

    expect(made).toMatchObject({ status: "processing", totalPapers: 2 });
  });

  it("ends a job as failed, with why, when its papers can't be read", async () => {
    const { alice, settled } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const start = () => alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "none" } });

    // The search counted, and then OpenAlex fails on its papers.
    const failing = await start();
    refusals = [new Response(JSON.stringify({ message: "upstream connect error" }), { status: 503 })];
    expect(await settled(failing.jobId)).toMatchObject({ status: "failed", failure: expect.stringMatching(/503/) });

    // Every paper is outside the search's rating filter.
    const { alice: rater, settled: rated } = await setup({ ...search, id: "local-rated", onlyRatedPapers: true, ratingRange: [3, 5] });
    const empty = await rater.action(api.screening.start.screen, { set: { kind: "search", searchId: "local-rated" }, first: 1, last: 10, ...job, saveTo: { kind: "none" } });
    expect(await rated(empty.jobId)).toMatchObject({ status: "failed", failure: expect.stringMatching(/rating filter/) });
  });

  it("stops reading a job cancelled before its papers came, and gives it none", async () => {
    const { t, alice, read } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 450, ...job, saveTo: { kind: "none" } });
    await alice.mutation(api.screening.mutations.cancelScreeningJob, { jobId });
    await readsOver(t);

    // At most the page a step had already asked for.
    expect(pages().length).toBeLessThanOrEqual(1);
    expect((await read(jobId))?.status).toBe("cancelled");
    expect(await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1))).toHaveLength(0);
  });

  it("stops reading for a job cancelled while a stretch its rating filter left empty was read", async () => {
    total = 2_500;
    const { t, alice, read } = await setup({ ...search, sortBy: "relevance_score:desc", onlyRatedPapers: true, ratingRange: [3, 5] });

    held = new Promise((resolve) => (releaseHeld = resolve));
    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 2_500, ...job, saveTo: { kind: "none" } });
    // Cancelled while OpenAlex is still answering the first stretch's pages.
    await vi.waitFor(() => expect(pages().length).toBeGreaterThan(0), { timeout: 10_000, interval: 20 });
    await alice.mutation(api.screening.mutations.cancelScreeningJob, { jobId });
    releaseHeld!();
    await readsOver(t);

    // The page it was reading, and none after it.
    expect(pages()).toHaveLength(1);
    expect((await read(jobId))?.status).toBe("cancelled");
  });

  it("makes the new collection a job saves to once the job has its papers, and not for one that gets none", async () => {
    const { t, alice, settled } = await setup({ ...search, sortBy: "relevance_score:desc" });
    const start = () => alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 10, ...job, saveTo: { kind: "new", name: "Trials to read" } });
    const collections = () => t.run((ctx) => ctx.db.query("collections").take(5));

    const failing = await start();
    refusals = [new Response(JSON.stringify({ message: "upstream connect error" }), { status: 503 })];
    expect((await settled(failing.jobId)).status).toBe("failed");
    expect(await collections()).toHaveLength(0);

    const made = await settled((await start()).jobId);
    const [collection] = await collections();
    expect(collection).toMatchObject({ name: "Trials to read" });
    expect(made.targetCollectionId).toBe(collection!._id);
  });

  it("gives no papers to a job whose person was suspended while they were read", async () => {
    const { t, userId, alice, settled } = await setup({ ...search, sortBy: "relevance_score:desc" });

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "search", searchId: search.id }, first: 1, last: 450, ...job, saveTo: { kind: "none" } });
    await t.run((ctx) => ctx.db.patch("users", userId, { state: "suspended" }));

    expect(await settled(jobId)).toMatchObject({ status: "failed", failure: expect.stringMatching(/suspended/i) });
    expect(await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1))).toHaveLength(0);
  });

  it("ends a job the person can't pay for out of credits, with none of its papers", async () => {
    const { t, screen } = await setup(search, [], 5);

    const { jobId, made } = await screen({ first: 1, last: 10 });

    expect(made).toMatchObject({ status: "creditsExhausted", totalPapers: 0 });
    expect(await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1))).toHaveLength(0);
  });

  it("refuses another account's search", async () => {
    const { t } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { clerkId: "bob", email: "bob@example.com", state: "active", createdAt: 1, updatedAt: 1 }));

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

  it("gives a signed-out visitor, counted by their address, the visitor's allowance and an account its own", async () => {
    const t = convexTest(schema);
    const spend = (clerkId: string, count: number) => t.mutation(internal.paperSets.search.spendRequests, { clerkId, count });
    // A visitor's minute holds 120 requests, an account's 300.
    expect(await spend("visitor:3f2a", 120)).toBe(true);
    expect(await spend("visitor:3f2a", 1)).toBe(false);
    expect(await spend("clerk_1", 121)).toBe(true);
  });
});
