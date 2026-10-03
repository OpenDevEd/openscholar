import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import { createJob } from "./createJob.test-support";
import { setupScreeningWorkpool } from "./workpool.test-support";

const questions = [{ key: "q1", question: "Randomized?" }, { key: "q2", question: "Primary schools?" }];
// Included from 2 points: a randomized study, or one unclear on that and set in primary schools.
const scoringConfig = {
  rules: [{ questionKey: "q1", yesPoints: 2, noPoints: 0, nullPoints: 1 }, { questionKey: "q2", yesPoints: 1, noPoints: 0, nullPoints: 0 }],
  starThresholds: [{ minScore: 1, stars: 1 }, { minScore: 3, stars: 5 }],
  minimumScore: 2,
};
const paper = (i: number) => ({ openalexId: `https://openalex.org/W${i}`, title: `Paper ${i} on reading`, authors: [i === 3 ? "Piper, B." : "Author, A."], publicationYear: 2024, venue: "A journal", citedByCount: 10 * i });
/** What the model answers for each paper; null answers nothing, as a paper it couldn't read. */
const ANSWERS: Array<Record<string, boolean | null> | null> = [
  { "Randomized?": true, "Primary schools?": true }, // W1: 3 points, included
  { "Randomized?": null, "Primary schools?": false }, // W2: 1 point, and a yes would make 2: unclear
  { "Randomized?": false, "Primary schools?": true }, // W3: 1 point, and nothing unclear: excluded
  null, // W4: failed
  { "Randomized?": true, "Primary schools?": false }, // W5: 2 points, included
];

/** A job of five papers the model has answered, bookkept. */
async function screened() {
  const t = convexTest(schema);
  setupScreeningWorkpool(t);
  const userId = await t.run(async (ctx) => {
    for (const clerkId of ["owner", "someone_else"]) await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 });
    const owner = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "owner")).unique())!;
    await seedCreditsForTest(ctx, { userId: owner._id, free: 1_000, paid: 0, now: 1 });
    return owner._id;
  });
  const as = t.withIdentity({ subject: "owner" });
  const { jobId } = await createJob(as, { papers: ANSWERS.map((_, i) => paper(i + 1)), questions, scoringConfig });
  const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(10));
  vi.useFakeTimers();
  for (const [i, answers] of ANSWERS.entries()) {
    await t.mutation(internal.screening.mutations.handleScreeningComplete, {
      workId: `work_${i}`,
      context: { jobId, resultId: results[i]._id },
      result: answers
        ? { kind: "success", returnValue: { responses: encodeQuestionResponseMap(answers), confidences: encodeQuestionResponseMap({ "Randomized?": 0.9, "Primary schools?": 0.7 }), confidence: 0.8 } }
        : { kind: "failed", error: "The model didn't answer" },
    });
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  const job = () => as.query(api.screening.queries.getScreeningJob, { jobId });
  const list = async (outcome: "included" | "unclear" | "excluded" | "failed", extra: { text?: string } = {}, signed = as) =>
    (await signed.query(api.screening.papers.list, { jobId, outcome, paginationOpts: { cursor: null, numItems: 10 }, ...extra })).page;
  return { t, as, userId, jobId, job, list };
}

describe("a screening job's papers", () => {
  it("lands each paper in its outcome, and keeps the counts and each question's answers as papers settle", async () => {
    const { job, list } = await screened();
    expect(await job()).toMatchObject({
      outcomes: { included: 2, unclear: 1, excluded: 1, failed: 1 },
      tallies: [{ key: "q1", yes: 2, no: 1, unclear: 1 }, { key: "q2", yes: 2, no: 2, unclear: 0 }],
    });
    expect((await list("unclear")).map((row) => row.title)).toEqual(["Paper 2 on reading"]);
    expect((await list("failed")).map((row) => row.title)).toEqual(["Paper 4 on reading"]);
    const [first] = await list("included");
    expect(first).toMatchObject({
      openalexId: "https://openalex.org/W1", venue: "A journal", citedByCount: 10, outcome: "included", score: 3, stars: 5,
      answers: [{ key: "q1", answer: true, changed: false, confidence: 0.9 }, { key: "q2", answer: true, changed: false, confidence: 0.7 }],
    });
  });

  it("pages an outcome by cursor in the job's order, finds papers by title or author, and shows no one else's", async () => {
    const { t, as, jobId, list } = await screened();
    const first = await as.query(api.screening.papers.list, { jobId, outcome: "included", paginationOpts: { cursor: null, numItems: 1 } });
    expect(first.page.map((row) => row.openalexId)).toEqual(["https://openalex.org/W1"]);
    expect(first.isDone).toBe(false);
    const second = await as.query(api.screening.papers.list, { jobId, outcome: "included", paginationOpts: { cursor: first.continueCursor, numItems: 1 } });
    expect(second.page.map((row) => row.openalexId)).toEqual(["https://openalex.org/W5"]);

    expect((await list("excluded", { text: "PIPER" })).map((row) => row.title)).toEqual(["Paper 3 on reading"]);
    expect((await list("included", { text: "paper 5" })).map((row) => row.title)).toEqual(["Paper 5 on reading"]);
    expect(await list("included", { text: "piper" })).toEqual([]);
    expect(await list("included", {}, t.withIdentity({ subject: "someone_else" }))).toEqual([]);
  });

  it("moves a paper to the outcome its changed answer gives it, saves one that becomes included, and puts the model's answer back", async () => {
    const { t, as, userId, jobId, job, list } = await screened();
    const answer = (paperId: string, questionKey: string, value: boolean | null | "model", signed = as) =>
      signed.mutation(api.screening.papers.answer, { jobId, paperId: `https://openalex.org/${paperId}`, questionKey, answer: value });
    const saved = () => t.run(async (ctx) => (await ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", userId).eq("openalexId", "https://openalex.org/W3")).take(2)).length);
    expect(await saved()).toBe(0);

    // W3 was excluded: answering that it's randomized takes it to 3 points.
    expect(await answer("W3", "q1", true)).toEqual({ outcome: "included" });
    expect(await job()).toMatchObject({
      outcomes: { included: 3, unclear: 1, excluded: 0, failed: 1 },
      tallies: [{ key: "q1", yes: 3, no: 0, unclear: 1 }, { key: "q2", yes: 2, no: 2, unclear: 0 }],
    });
    const moved = (await list("included")).find((row) => row.openalexId === "https://openalex.org/W3");
    expect(moved).toMatchObject({ score: 3, stars: 5, answers: [{ key: "q1", answer: true, changed: true, confidence: 0.9 }, { key: "q2", answer: true, changed: false }] });
    expect(await list("excluded")).toEqual([]);
    expect(await saved()).toBe(1);

    expect(await answer("W3", "q1", "model")).toEqual({ outcome: "excluded" });
    expect(await job()).toMatchObject({ outcomes: { included: 2, unclear: 1, excluded: 1, failed: 1 }, tallies: [{ key: "q1", yes: 2, no: 1, unclear: 1 }, { key: "q2", yes: 2, no: 2, unclear: 0 }] });
    expect((await list("excluded"))[0]).toMatchObject({ score: 1, answers: [{ key: "q1", answer: false, changed: false }, { key: "q2", answer: true, changed: false }] });

    // Unclear to yes on the unclear paper's deciding question includes it.
    expect(await answer("W2", "q1", true)).toEqual({ outcome: "included" });
    expect((await job())!.outcomes).toEqual({ included: 3, unclear: 0, excluded: 1, failed: 1 });

    await expect(answer("W4", "q1", true)).rejects.toThrow(/Only a screened paper/);
    await expect(answer("W1", "q9", true)).rejects.toThrow(/doesn't ask that question/);
    await expect(answer("W1", "q1", false, t.withIdentity({ subject: "someone_else" }))).rejects.toThrow(/not found/i);
  });

  it("gives a job from before outcomes were kept its papers' outcomes and its counts", async () => {
    const { t, job, list } = await screened();
    // As a job screened before: no outcome on its papers, no unclear count or tallies on its progress.
    await t.run(async (ctx) => {
      for (const result of await ctx.db.query("screeningResults").take(10)) await ctx.db.patch("screeningResults", result._id, { outcome: undefined });
      const progress = (await ctx.db.query("screeningJobProgress").first())!;
      await ctx.db.patch("screeningJobProgress", progress._id, { unclear: undefined, tallies: undefined });
    });
    expect(await list("included")).toEqual([]);
    expect(await t.action(internal.migrations.screeningOutcomes.verify, {})).toBe(5);

    vi.useFakeTimers();
    await t.mutation(internal.migrations.screeningOutcomes.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(await t.action(internal.migrations.screeningOutcomes.verify, {})).toBe(0);
    expect(await job()).toMatchObject({
      outcomes: { included: 2, unclear: 1, excluded: 1, failed: 1 },
      tallies: [{ key: "q1", yes: 2, no: 1, unclear: 1 }, { key: "q2", yes: 2, no: 2, unclear: 0 }],
    });
    expect((await list("included")).map((row) => row.openalexId)).toEqual(["https://openalex.org/W1", "https://openalex.org/W5"]);
  });
});
