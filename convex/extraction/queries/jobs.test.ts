// The extraction job list, read a page at a time on the server (#422): its four orders,
// its text filter, its kept count, and the migration that readies older jobs.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedAccount } from "../../lib/maxSize.test-support";
import { runUntriggered } from "../../../tests/convex-test-with-limits";

type Test = ReturnType<typeof convexTest>;
type Status = "pending" | "extracting" | "completed" | "failed" | "cancelled" | "paused";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Jobs made one after another, so the order they were made in is the order they list in. */
async function seedJobs(t: Test, userId: Id<"users">, jobs: Array<{ name: string; status?: Status; description?: string }>) {
  for (const [i, job] of jobs.entries()) {
    await t.run((ctx) => ctx.db.insert("extractionJobs", { userId, mode: "extraction", totalPapers: 1, createdAt: i + 1, updatedAt: i + 1, ...job }));
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

const JOBS: Array<{ name: string; status: Status; description?: string }> = [
  { name: "beta trials", status: "completed" },
  { name: "Alpha review", status: "extracting", description: "Reading outcomes in primary schools" },
  { name: "Écoles rurales", status: "failed" },
  { name: "delta cohort", status: "pending" },
  { name: "Charlie study", status: "cancelled" },
  { name: "zeta notes", status: "paused" },
];

describe("the extraction job list", () => {
  it("lists newest or oldest first, by name whatever its case or accents, and by status in the list's order", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedJobs(t, userId, JOBS);
    const names = async (sort: "recent" | "oldest" | "name" | "status") =>
      (await as.query(api.extraction.queries.listJobs, { sort, paginationOpts: { cursor: null, numItems: 10 } })).page.map((job) => job.name);

    expect(await names("oldest")).toEqual(JOBS.map((job) => job.name));
    expect(await names("recent")).toEqual(JOBS.map((job) => job.name).reverse());
    expect(await names("name")).toEqual(["Alpha review", "beta trials", "Charlie study", "delta cohort", "Écoles rurales", "zeta notes"]);
    // Waiting, running, completed, failed, cancelled, then the rest.
    expect(await names("status")).toEqual(["delta cohort", "Alpha review", "beta trials", "Écoles rurales", "Charlie study", "zeta notes"]);
  });

  it("steps through a status order by cursor without repeating or dropping a job", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedJobs(t, userId, JOBS);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let reads = 0; reads < 10; reads++) {
      const page: { page: Array<{ name: string }>; isDone: boolean; continueCursor: string } = await as.query(api.extraction.queries.listJobs, { sort: "status", paginationOpts: { cursor, numItems: 2 } });
      seen.push(...page.page.map((job) => job.name));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(seen).toEqual(["delta cohort", "Alpha review", "beta trials", "Écoles rurales", "Charlie study", "zeta notes"]);
  });

  it("keeps only jobs whose name or description contains the text, in the order asked for, and shows no one else's", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedJobs(t, userId, JOBS);
    const someoneElse = await t.run((ctx) => ctx.db.insert("users", { clerkId: "someone_else", email: "else@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    await seedJobs(t, someoneElse, [{ name: "Alpha of another person", status: "completed" }]);
    const names = async (text: string, sort: "recent" | "status" = "recent") =>
      (await as.query(api.extraction.queries.listJobs, { sort, text, paginationOpts: { cursor: null, numItems: 10 } })).page.map((job) => job.name);

    expect(await names("ALPHA")).toEqual(["Alpha review"]);
    expect(await names("primary schools")).toEqual(["Alpha review"]);
    expect(await names("ta", "status")).toEqual(["delta cohort", "beta trials", "zeta notes"]);
    expect(await names("nothing like this")).toEqual([]);
  });

  it("finds the one match among thousands of jobs over several reads, each within its allowance", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    // The match is the oldest completed job: last in the status order, behind 2,299 others.
    for (let from = 0; from < 2_300; from += 460) {
      await t.run(async (ctx) => {
        for (let i = from; i < from + 460; i++) {
          await ctx.db.insert("extractionJobs", { userId, mode: "extraction", totalPapers: 1, createdAt: i, updatedAt: i, name: i === 0 ? "needle" : `job ${i}`, status: i % 2 ? "pending" : "completed" });
        }
      });
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const seen: string[] = [];
    let cursor: string | null = null;
    let reads = 0;
    for (; reads < 5; reads++) {
      const page: { page: Array<{ name: string }>; isDone: boolean; continueCursor: string } = await as.query(api.extraction.queries.listJobs, { sort: "status", text: "needle", paginationOpts: { cursor, numItems: 20 } });
      seen.push(...page.page.map((job) => job.name));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(seen).toEqual(["needle"]);
    expect(reads).toBeGreaterThan(0);
  });

  it("keeps the count of a person's jobs as they are made and deleted", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    expect(await as.query(api.extraction.queries.countJobs, {})).toBe(0);
    await seedJobs(t, userId, JOBS);
    expect(await as.query(api.extraction.queries.countJobs, {})).toBe(6);

    await t.run(async (ctx) => ctx.db.delete((await ctx.db.query("extractionJobs").withIndex("by_user", (q) => q.eq("userId", userId)).first())!._id));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await as.query(api.extraction.queries.countJobs, {})).toBe(5);
  });

  it("follows a renamed job in the name order", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedJobs(t, userId, JOBS);
    await t.run(async (ctx) => {
      const job = (await ctx.db.query("extractionJobs").withIndex("by_user", (q) => q.eq("userId", userId)).take(10)).find((row) => row.name === "zeta notes")!;
      await ctx.db.patch(job._id, { name: "Aardvark notes" });
    });
    const page = await as.query(api.extraction.queries.listJobs, { sort: "name", paginationOpts: { cursor: null, numItems: 2 } });
    expect(page.page.map((job) => job.name)).toEqual(["Aardvark notes", "Alpha review"]);
  });

  it("gives jobs from before the list paged their sort name, and their owners their count", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedJobs(t, userId, JOBS);
    // As jobs saved before: no sort name, and no count. Written without the triggers, which would put the sort name back.
    await runUntriggered(t, async (ctx) => {
      for (const job of await ctx.db.query("extractionJobs").take(10)) await ctx.db.replace(job._id, (({ _id, _creationTime, sortName, ...rest }) => rest)(job));
      for (const row of await ctx.db.query("recordCounts").take(10)) await ctx.db.delete(row._id);
    });
    expect(await t.action(internal.migrations.pagedExtractionJobs.verify, {})).toBe(7);

    await t.mutation(internal.migrations.pagedExtractionJobs.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.action(internal.migrations.pagedExtractionJobs.verify, {})).toBe(0);
    expect(await as.query(api.extraction.queries.countJobs, {})).toBe(6);
    expect((await as.query(api.extraction.queries.listJobs, { sort: "name", paginationOpts: { cursor: null, numItems: 1 } })).page[0].name).toBe("Alpha review");
  });
});
