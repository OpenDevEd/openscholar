// A saved search as an extraction's source: the job's setup reads it from OpenAlex a page at a
// time with OpenScholar's key, as many papers as were chosen, spending the person's allowance (#634).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { rowFromBucketItem, type BucketItemInput } from "./jobSources";
import { setupExtractionPaperWorkpool } from "./queue/workpool.test-support";
import { madeBy } from "../workspaces/actor.test-support";

/** An abstract long enough for a paper to be read from it. */
const ABSTRACT = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`word${i}`, [i]]));
let requests: URL[] = [];
/** OpenAlex, answering every cursor page with 200 works numbered from its start, `count` in all. */
const openAlexOf = (count: number) => vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  requests.push(url);
  const start = Number(url.searchParams.get("cursor") === "*" ? 0 : url.searchParams.get("cursor"));
  const results = Array.from({ length: Math.max(0, Math.min(200, count - start)) }, (_, i) => ({ id: `https://openalex.org/W${start + i + 1}`, display_name: `Paper ${start + i + 1}`, abstract_inverted_index: ABSTRACT }));
  return Response.json({ meta: { count, next_cursor: start + 200 < count ? String(start + 200) : null }, results });
});

beforeEach(() => {
  requests = [];
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A job whose one source is a saved search, and a run of its setup. */
async function jobOf(searchFilters: BucketItemInput["searchFilters"]) {
  const t = convexTest(schema);
  setupExtractionPaperWorkpool(t);
  const jobId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "ada", email: "ada@test", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 });
    const id = await ctx.db.insert("extractionJobs", { ...(await madeBy(ctx, userId)), name: "Search", status: "pending", runEpoch: 0, createdAt: 1, updatedAt: 1 });
    // Written as it was saved: a search in the old shape can't be written now, only read.
    await ctx.db.insert("extractionJobSources", rowFromBucketItem(id, 0, { source: "history", bucketKey: "search", sourceRefId: "search-1", title: "tutor", authors: [], searchFilters }));
    return id;
  });
  const setup = () => t.action(internal.extraction.actions.setupExtractionQueueJob, { jobId, expectedEpoch: 0 });
  const job = () => t.run((ctx) => ctx.db.get("extractionJobs", jobId as Id<"extractionJobs">));
  const papers = () => t.run(async (ctx) => (await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(10_000)).length);
  const spent = async () => (await t.run(async (ctx) => (await ctx.db.query("rateLimits").collect()).find((row) => row.name === "openalex-day")))?.value;
  return { t, setup, job, papers, spent };
}

it("refuses a search saved before its exact request was kept, without asking OpenAlex", async () => {
  vi.stubGlobal("fetch", openAlexOf(900));
  const { setup, job } = await jobOf({ query: "heart disease", selectedCountryFocus: ["KE"], limit: 2 } as never);
  await setup();
  expect((await job())?.error?.message).toMatch(/Add it again/);
  expect(requests).toHaveLength(0);
});

it("reads the chosen number of papers a page at a time with OpenScholar's key, spending one request a page", { tags: ["size"] }, async () => {
  vi.stubGlobal("fetch", openAlexOf(900));
  const { setup, job, papers, spent } = await jobOf({ query: "tutor", openAlexQuery: { filter: "title_and_abstract.search:tutor", sort: "cited_by_count:desc" }, limit: 450 });
  await setup();
  expect(await papers()).toBe(450);
  expect(await job()).toMatchObject({ totalPapers: 450, status: "extracting" });
  expect((await job())?.setup).toBeUndefined();
  expect(requests).toHaveLength(3);
  expect(requests.every((url) => url.searchParams.get("api_key") === "platform-key" && url.searchParams.get("filter") === "title_and_abstract.search:tutor")).toBe(true);
  expect(await spent()).toBe(20_000 - 3);
});

it("stops where a search runs out, charging only the pages it read", async () => {
  vi.stubGlobal("fetch", openAlexOf(50));
  const { setup, papers, spent } = await jobOf({ query: "tutor", openAlexQuery: { filter: "title_and_abstract.search:tutor", sort: "cited_by_count:desc" }, limit: 1000 });
  await setup();
  expect(await papers()).toBe(50);
  expect(requests).toHaveLength(1);
  expect(await spent()).toBe(20_000 - 1);
});
