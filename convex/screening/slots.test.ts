// Each person's Screen all papers run under their limit and the rest wait their turn (#335).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { SCREENING_POOL_SIZE } from "../workpool";
import { createJob } from "./createJob.test-support";
import { estimateScreening } from "./estimate";
import { setupScreeningWorkpool } from "./workpool.test-support";

const questions = [{ key: "q1", question: "Is this relevant?" }];
const scoringConfig = { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 0, stars: 1 }] };
const papers = (count: number, prefix: string) => Array.from({ length: count }, (_, i) => ({ openalexId: `${prefix}${i}`, title: `Paper ${i}` }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema);
  setupScreeningWorkpool(t);
  const person = async (clerkId: string) => {
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { libraryItemCount: 0, clerkId, email: `${clerkId}@test`, state: "active", createdAt: 1, updatedAt: 1 });
      await seedCreditsForTest(ctx, { userId: id, free: 100_000 });
      return id;
    });
    return { userId, as: t.withIdentity({ subject: clerkId }) };
  };
  return { t, person };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

/** A job's results: those started (with work in the pool) and those waiting for a slot. */
const papersOf = (t: T, jobId: Id<"screeningJobs">) =>
  t.run(async (ctx) => {
    const rows = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
    return { rows, started: rows.filter((row) => row.workId !== undefined), waiting: rows.filter((row) => row.waitingSince !== undefined) };
  });
const running = (t: T, userId: Id<"users">) =>
  t.run(async (ctx) => (await ctx.db.query("screeningSlots").withIndex("by_user", (q) => q.eq("userId", userId)).unique())?.running);

/** Papers finishing as their work completes them, then one batch of the bookkeeping worker. */
async function finishAndBookkeep(t: T, ids: Id<"screeningResults">[]) {
  await t.run(async (ctx) => {
    for (const id of ids) await ctx.db.patch("screeningResults", id, { status: "completed", completedAt: 2, doneAt: ctx.db.vars.commitTs });
  });
  await t.mutation(internal.screening.bookkeeping.bookkeep, { results: ids });
}

describe("each person's paper slots", () => {
  it("starts the person's free slots and keeps the rest of the job waiting, in order", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");

    const { jobId } = await createJob(ada.as, { papers: papers(50, "a"), questions, scoringConfig });

    const { started, waiting } = await papersOf(t, jobId);
    expect(started).toHaveLength(SCREENING_POOL_SIZE);
    expect(started.map((row) => row.openalexId)).toEqual(papers(SCREENING_POOL_SIZE, "a").map((paper) => paper.openalexId));
    expect(waiting).toHaveLength(50 - SCREENING_POOL_SIZE);
    expect(await running(t, ada.userId)).toBe(SCREENING_POOL_SIZE);
  });

  it("accepts another job from the same person, which waits, while someone else's job starts at once", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");
    const grace = await person("grace");
    await createJob(ada.as, { papers: papers(50, "a"), questions, scoringConfig });

    const second = await createJob(ada.as, { papers: papers(10, "b"), questions, scoringConfig });
    const other = await createJob(grace.as, { papers: papers(10, "g"), questions, scoringConfig });

    expect((await papersOf(t, second.jobId)).started).toHaveLength(0);
    expect((await papersOf(t, other.jobId)).started).toHaveLength(10);
  });

  it("starts the next waiting papers as running ones finish, oldest job first", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");
    const first = await createJob(ada.as, { papers: papers(25, "a"), questions, scoringConfig });
    const second = await createJob(ada.as, { papers: papers(10, "b"), questions, scoringConfig });

    await finishAndBookkeep(t, (await papersOf(t, first.jobId)).started.slice(0, 8).map((row) => row._id));

    // The first job's last 5 waiting papers start, then 3 of the second's.
    expect((await papersOf(t, first.jobId)).waiting).toHaveLength(0);
    expect((await papersOf(t, second.jobId)).started).toHaveLength(3);
    expect(await running(t, ada.userId)).toBe(SCREENING_POOL_SIZE);
  });

  it("holds a person to their plan's concurrency", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");
    await t.run(async (ctx) => {
      const account = await ctx.db.query("billingAccounts").withIndex("by_user", (q) => q.eq("userId", ada.userId)).unique();
      await ctx.db.patch("billingAccounts", account!._id, { concurrency: 5 });
    });

    const { jobId } = await createJob(ada.as, { papers: papers(20, "a"), questions, scoringConfig });

    expect((await papersOf(t, jobId)).started).toHaveLength(5);
  });

  it("skips an ended job's waiting papers, which held no slot, and frees its running ones as they finish", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");
    const ended = await createJob(ada.as, { papers: papers(30, "a"), questions, scoringConfig });
    const next = await createJob(ada.as, { papers: papers(5, "b"), questions, scoringConfig });
    await t.run((ctx) => ctx.db.patch("screeningJobs", ended.jobId, { status: "cancelled" }));

    await t.mutation(internal.screening.mutations.endScreeningWork, { jobId: ended.jobId, cursor: null });
    const skipped = (await papersOf(t, ended.jobId)).rows.filter((row) => row.status === "skipped");
    expect(skipped).toHaveLength(30 - SCREENING_POOL_SIZE);
    await t.mutation(internal.screening.bookkeeping.bookkeep, { results: skipped.map((row) => row._id) });
    expect(await running(t, ada.userId)).toBe(SCREENING_POOL_SIZE);

    await finishAndBookkeep(t, (await papersOf(t, ended.jobId)).started.slice(0, 5).map((row) => row._id));
    expect((await papersOf(t, next.jobId)).started).toHaveLength(5);
  });

  it("starts only the papers a job's spending limit has room for, and stops the job there with the rest unread", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");
    // Ada said yes to what three papers are estimated to cost; the job found twelve.
    const spendCap = estimateScreening(3, 0).credits;
    const { jobId } = await createJob(ada.as, { papers: papers(12, "a"), questions, scoringConfig, spendCap });
    const other = await createJob(ada.as, { papers: papers(4, "b"), questions, scoringConfig });
    const finish = async (ids: Id<"screeningResults">[], creditsUsed: number) => {
      await t.run(async (ctx) => {
        for (const id of ids) await ctx.db.patch("screeningResults", id, { status: "completed", completedAt: 2, creditsUsed, doneAt: ctx.db.vars.commitTs });
      });
      await t.mutation(internal.screening.bookkeeping.bookkeep, { results: ids });
    };

    // Three start, however many slots are free; a job with no limit takes the slots as before.
    const [one, two, three] = (await papersOf(t, jobId)).started.map((row) => row._id);
    expect((await papersOf(t, jobId)).started).toHaveLength(3);
    expect((await papersOf(t, other.jobId)).started).toHaveLength(4);

    // Two finish having cost all of it between them. The third is still being read, so the job goes on, and starts nothing.
    await finish([one, two], spendCap / 2);
    expect((await papersOf(t, jobId)).started).toHaveLength(3);
    expect(await t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ status: "processing" });

    // It finishes: nothing is being read and nothing is left to spend, so the job stops, its nine waiting papers skipped.
    await finish([three], 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    const { rows, waiting } = await papersOf(t, jobId);
    expect(waiting).toHaveLength(0);
    expect(rows.filter((row) => row.status === "skipped")).toHaveLength(9);
    expect(await t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ status: "creditsExhausted", capped: true });
  });

  it("starts the person's next job once one that filled the queue has stopped at its limit", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");
    // Room for one paper of twenty-five: the rest wait at the head of Ada's queue, ahead of her next job's.
    const first = await createJob(ada.as, { papers: papers(25, "a"), questions, scoringConfig, spendCap: estimateScreening(1, 0).credits });
    const next = await createJob(ada.as, { papers: papers(3, "b"), questions, scoringConfig });
    expect((await papersOf(t, next.jobId)).started).toHaveLength(0);

    const [only] = (await papersOf(t, first.jobId)).started.map((row) => row._id);
    await t.run((ctx) => ctx.db.patch("screeningResults", only, { status: "completed", completedAt: 2, creditsUsed: 5, doneAt: ctx.db.vars.commitTs }));
    await t.mutation(internal.screening.bookkeeping.bookkeep, { results: [only] });
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));

    expect(await t.run((ctx) => ctx.db.get("screeningJobs", first.jobId))).toMatchObject({ status: "creditsExhausted", capped: true });
    expect((await papersOf(t, next.jobId)).started).toHaveLength(3);
  });

  it("makes the papers a job still had to make as skipped once it has stopped at its limit, so none waits for good", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");
    const { jobId } = await createJob(ada.as, { papers: papers(2, "a"), questions, scoringConfig, spendCap: 9 });
    // It stopped while a job of more than one batch was still making its papers.
    await t.run((ctx) => ctx.db.patch("screeningJobs", jobId, { capped: true }));

    await t.mutation(internal.screening.mutations.createScreeningResults, { jobId, papers: papers(2, "late"), createdAt: 3 });

    const late = (await papersOf(t, jobId)).rows.filter((row) => row.openalexId.startsWith("late"));
    expect(late.map((row) => [row.status, row.waitingSince, row.workId])).toEqual([["skipped", undefined, undefined], ["skipped", undefined, undefined]]);
  });

  it("starts a later job's waiting papers in free slots however many jobs the person has", async () => {
    const { t, person } = await setup();
    const ada = await person("ada");
    for (let j = 0; j < 10; j++) await createJob(ada.as, { papers: papers(1, `j${j}-`), questions, scoringConfig });

    const eleventh = await createJob(ada.as, { papers: papers(5, "k"), questions, scoringConfig });

    expect((await papersOf(t, eleventh.jobId)).started).toHaveLength(5);
    expect(await running(t, ada.userId)).toBe(15);
  });
});
