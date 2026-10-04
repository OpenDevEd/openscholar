import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { answerPaper } from "../research/answers";
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

/**
 * A job of five papers the model has answered, bookkept unless `bookkept` is false: then
 * `settle` runs the worker. `before` runs once the job exists, before the model answers.
 */
async function screened({ bookkept = true, before }: { bookkept?: boolean; before?: (t: ReturnType<typeof convexTest>, jobId: Id<"screeningJobs">) => Promise<void> } = {}) {
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
  await before?.(t, jobId);
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
  const settle = async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  };
  if (bookkept) await settle();
  const job = () => as.query(api.screening.queries.getScreeningJob, { jobId });
  const answer = (paperId: string, questionKey: string, value: boolean | null | "model", signed = as) =>
    signed.mutation(api.screening.papers.answer, { jobId, paperId: `https://openalex.org/${paperId}`, questionKey, answer: value });
  /** How many of the owner's library items are paper W3. */
  const saved = () => t.run(async (ctx) => (await ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", userId).eq("openalexId", "https://openalex.org/W3")).take(2)).length);
  const list = async (outcome: "included" | "unclear" | "excluded" | "failed", extra: { text?: string } = {}, signed = as) =>
    (await signed.query(api.screening.papers.list, { jobId, outcome, paginationOpts: { cursor: null, numItems: 10 }, ...extra })).page;
  return { t, as, jobId, job, list, answer, saved, settle };
}

const COUNTED = {
  outcomes: { included: 2, unclear: 1, excluded: 1, failed: 1 },
  tallies: [{ key: "q1", yes: 2, no: 1, unclear: 1 }, { key: "q2", yes: 2, no: 2, unclear: 0 }],
};
/** The counts once W3's first question is answered yes, which takes it from excluded to included. */
const W3_INCLUDED = {
  outcomes: { included: 3, unclear: 1, excluded: 0, failed: 1 },
  tallies: [{ key: "q1", yes: 3, no: 0, unclear: 1 }, { key: "q2", yes: 2, no: 2, unclear: 0 }],
};

describe("a screening job's papers", () => {
  it("lands each paper in its outcome, and keeps the counts and each question's answers as papers settle", async () => {
    const { t, job, list } = await screened();
    expect(await job()).toMatchObject(COUNTED);
    // Each paper recorded what it counted, so the migration for older jobs has nothing to add.
    expect(await t.action(internal.migrations.screeningOutcomes.verify, {})).toBe(0);
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

  it("reads one paper as its list shows it, for its owner alone, and lists a person's jobs of one status", async () => {
    const { t, as, jobId, list } = await screened();
    const paperId = "https://openalex.org/W3";
    expect(await as.query(api.screening.papers.get, { jobId, paperId })).toEqual((await list("excluded"))[0]);
    expect(await t.withIdentity({ subject: "someone_else" }).query(api.screening.papers.get, { jobId, paperId })).toBeNull();
    expect(await as.query(api.screening.papers.get, { jobId, paperId: "https://openalex.org/W99" })).toBeNull();

    const jobs = (status: "completed" | "cancelled") => as.query(api.screening.queries.listUserScreeningJobs, { status, paginationOpts: { cursor: null, numItems: 5 } });
    expect((await jobs("completed")).page.map((job) => job._id)).toEqual([jobId]);
    expect((await jobs("cancelled")).page).toEqual([]);
  });

  it("moves a paper to the outcome its changed answer gives it, saves one that becomes included, and puts the model's answer back", async () => {
    const { t, as, job, list, answer, saved } = await screened();
    expect(await saved()).toBe(0);

    // W3 was excluded: answering that it's randomized takes it to 3 points.
    expect(await answer("W3", "q1", true)).toMatchObject({ outcome: "included" });
    expect(await job()).toMatchObject(W3_INCLUDED);
    const moved = (await list("included")).find((row) => row.openalexId === "https://openalex.org/W3");
    expect(moved).toMatchObject({ score: 3, stars: 5, answers: [{ key: "q1", answer: true, changed: true, confidence: 0.9 }, { key: "q2", answer: true, changed: false }] });
    expect(await list("excluded")).toEqual([]);
    expect(await saved()).toBe(1);

    expect(await answer("W3", "q1", "model")).toMatchObject({ outcome: "excluded" });
    expect(await job()).toMatchObject(COUNTED);
    expect((await list("excluded"))[0]).toMatchObject({ score: 1, answers: [{ key: "q1", answer: false, changed: false }, { key: "q2", answer: true, changed: false }] });

    // Removed from the library since: becoming included again saves it again.
    await as.mutation(api.library.mutations.removeFromLibrary, { openalexId: "https://openalex.org/W3" });
    expect(await saved()).toBe(0);
    expect(await answer("W3", "q1", true)).toMatchObject({ outcome: "included" });
    expect(await saved()).toBe(1);
    await answer("W3", "q1", "model");

    // Unclear to yes on the unclear paper's deciding question includes it.
    expect(await answer("W2", "q1", true)).toMatchObject({ outcome: "included" });
    expect((await job())!.outcomes).toEqual({ included: 3, unclear: 0, excluded: 1, failed: 1 });

    await expect(answer("W4", "q1", true)).rejects.toThrow(/Only a screened paper/);
    await expect(answer("W1", "q9", true)).rejects.toThrow(/doesn't ask that question/);
    await expect(answer("W1", "q1", false, t.withIdentity({ subject: "someone_else" }))).rejects.toThrow(/not found/i);
  });

  it("returns what puts a changed answer back (#342), with who set it, and refuses it once the answer has changed again", async () => {
    const { t, as, jobId, job, answer } = await screened();
    // W1 is included on its first answer alone, so changing its second moves it nowhere.
    const W1 = "https://openalex.org/W1";
    const run = (undo: NonNullable<Awaited<ReturnType<typeof answer>>["undo"]>) => as.mutation(api.screening.papers.answer, undo.args);
    const { userId, screeningId } = await t.run(async (ctx) => ({
      userId: (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "owner")).unique())!._id,
      screeningId: (await ctx.db.get("screeningJobs", jobId))!.screeningId,
    }));
    const asAssistant = (value: boolean | null) => t.mutation(internal.screening.papers.answerForAssistant, { userId, jobId, paperId: W1, questionKey: "q2", answer: value });
    /** W1's second answer as its job shows it, and as the screening stores it. */
    const shown = async () => (await as.query(api.screening.papers.get, { jobId, paperId: W1 }))!.answers[1];
    const stored = () =>
      t.run(async (ctx) => (await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId).eq("paperId", W1)).unique())!.answers.find((value) => value.question === "Primary schools?")!);

    // The model said yes. A change to that goes back to the model's answer, as the model's.
    const changed = await answer("W1", "q2", false);
    expect(changed.undo).toMatchObject({ path: "screening/papers:answer", args: { jobId, paperId: W1, questionKey: "q2", answer: { asOf: expect.any(Number) }, expect: { answer: false } } });
    const back = await run(changed.undo!);
    expect(back.outcome).toBe("included");
    expect(await job()).toMatchObject(COUNTED);
    expect(await shown()).toMatchObject({ answer: true, changed: false });
    expect(await stored()).toMatchObject({ answer: true, setBy: "model" });
    // Putting the model's answer back when it already stands changes nothing, so the undo of that undo still goes through.
    expect((await answer("W1", "q2", "model")).undo).toBeUndefined();
    await run(back.undo!);
    expect(await stored()).toMatchObject({ answer: false, setBy: "person" });

    // The assistant changes the person's answer twice. Undone newest first, each step comes back as it was,
    // the person's answer as the person's, whoever runs the undo.
    const first = await asAssistant(null);
    const second = await asAssistant(true);
    await expect(run(first.undo!)).rejects.toThrow(/changed since/);
    expect(await stored()).toMatchObject({ answer: true, setBy: "assistant" });
    await run(second.undo!);
    expect(await stored()).toMatchObject({ answer: null, setBy: "assistant" });
    await t.mutation(internal.screening.papers.answerForAssistant, { userId, ...first.undo!.args });
    expect(await stored()).toMatchObject({ answer: false, setBy: "person" });
    expect(await shown()).toMatchObject({ answer: false, changed: true });
    // Answering what it already is has nothing to undo.
    expect((await answer("W1", "q2", false)).undo).toBeUndefined();
  });

  it("returns no undo for an answer whose undo wouldn't put everything back", async () => {
    const { t, jobId, answer, saved } = await screened();
    // W3 becomes included, and the job saves it: putting the answer back wouldn't unsave it.
    expect((await answer("W3", "q1", true)).undo).toBeUndefined();
    expect(await saved()).toBe(1);
    // Taking it out of the included papers has none either: its undo would save it again, over what its rating is by then.
    expect((await answer("W3", "q1", false)).undo).toBeUndefined();

    // W5's second answer is changed on the screening after the job counted it, so the job's record and
    // the screening's differ. One step can't put both back.
    const screeningId = (await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!.screeningId;
    await t.run((ctx) => answerPaper(ctx, screeningId, "https://openalex.org/W5", [{ question: "Primary schools?", response: true }], "person", Date.now()));
    expect(await answer("W5", "q2", null)).toEqual({ outcome: "included" });
  });

  it("counts a paper once when its answer changes before the worker reaches it", async () => {
    const { job, list, answer, saved, settle } = await screened({ bookkept: false });
    expect(await answer("W3", "q1", true)).toMatchObject({ outcome: "included" });
    expect((await list("included")).map((row) => row.openalexId)).toContain("https://openalex.org/W3");

    await settle();
    expect(await job()).toMatchObject(W3_INCLUDED);
    expect(await saved()).toBe(1);
    // Counted on the changed answer, so putting the model's back takes away exactly that.
    expect(await answer("W3", "q1", "model")).toMatchObject({ outcome: "excluded" });
    expect(await job()).toMatchObject(COUNTED);
  });

  it("scores and counts a paper on a person's earlier answer, which the model's doesn't replace", async () => {
    const { job, list, answer, settle } = await screened({
      bookkept: false,
      before: (t, jobId) => t.run(async (ctx) => {
        const { screeningId } = (await ctx.db.get("screeningJobs", jobId))!;
        await answerPaper(ctx, screeningId!, "https://openalex.org/W3", [{ question: "Randomized?", response: true }], "person", 1);
      }),
    });
    // The model said no; while its answers wait to move, the paper already shows the person's.
    expect((await list("excluded"))[0].answers).toMatchObject([{ key: "q1", answer: true, changed: true, confidence: 0.9 }, { key: "q2", answer: true, changed: false }]);

    await settle();
    expect(await job()).toMatchObject(W3_INCLUDED);
    expect((await list("included")).find((row) => row.openalexId === "https://openalex.org/W3")).toMatchObject({ score: 3, stars: 5 });
    expect(await answer("W3", "q1", "model")).toMatchObject({ outcome: "excluded" });
    expect(await job()).toMatchObject(COUNTED);
  });

  it("keeps a paper's answers, score and outcome together when its search's page changes or clears the answers they share", async () => {
    const { t, jobId, job, list, answer } = await screened();
    const W3 = "https://openalex.org/W3";
    const screeningId = (await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!.screeningId!;
    const row = () => t.run((ctx) => ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId).eq("paperId", W3)).unique());
    const asScored = [{ key: "q1", answer: false, changed: false }, { key: "q2", answer: true, changed: false }];

    // As the search's page would: a person answers in the screening the job shares.
    await t.run((ctx) => answerPaper(ctx, screeningId, W3, [{ question: "Randomized?", response: true }], "person", 5));
    expect((await list("excluded"))[0]).toMatchObject({ openalexId: W3, score: 1, answers: asScored });
    expect(await job()).toMatchObject(COUNTED);

    // The page clears the paper's answers. The job still has its own, takes a change, and
    // puts back the answer its own run of the model gave.
    await t.run(async (ctx) => ctx.db.delete("screeningAnswers", (await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId).eq("paperId", W3)).unique())!._id));
    expect(await answer("W3", "q1", true)).toMatchObject({ outcome: "included" });
    expect(await job()).toMatchObject(W3_INCLUDED);
    expect(await answer("W3", "q1", "model")).toMatchObject({ outcome: "excluded" });
    expect(await job()).toMatchObject(COUNTED);
    expect((await list("excluded"))[0].answers).toMatchObject(asScored);
    // The change was written through: the shared answer is the model's again.
    expect((await row())?.answers.find((value) => value.question === "Randomized?")).toMatchObject({ answer: false, setBy: "model" });
  });

  it("gives a job from before outcomes were kept its papers' outcomes and its counts, each paper once", async () => {
    const { t, job, list, answer } = await screened();
    // As a job screened before: its papers have no outcome and haven't recorded what they count as; its progress has no unclear count or tallies.
    await t.run(async (ctx) => {
      for (const result of await ctx.db.query("screeningResults").take(10)) await ctx.db.patch("screeningResults", result._id, { outcome: undefined, counted: undefined });
      const progress = (await ctx.db.query("screeningJobProgress").first())!;
      await ctx.db.patch("screeningJobProgress", progress._id, { unclear: undefined, tallies: undefined });
    });
    expect(await list("included")).toEqual([]);
    expect(await t.action(internal.migrations.screeningOutcomes.verify, {})).toBe(5);
    // A paper answered before the migration reaches it records its counts then, and the migration leaves it.
    expect(await answer("W3", "q1", true)).toMatchObject({ outcome: "included" });
    expect(await t.action(internal.migrations.screeningOutcomes.verify, {})).toBe(4);

    vi.useFakeTimers();
    await t.mutation(internal.migrations.screeningOutcomes.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(await t.action(internal.migrations.screeningOutcomes.verify, {})).toBe(0);
    expect(await job()).toMatchObject(W3_INCLUDED);
    expect((await list("included")).map((row) => row.openalexId)).toEqual(["https://openalex.org/W1", "https://openalex.org/W3", "https://openalex.org/W5"]);
    await answer("W3", "q1", "model");
    expect(await job()).toMatchObject(COUNTED);
  });
});
