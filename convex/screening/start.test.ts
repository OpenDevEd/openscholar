// Screen all on any paper set (#341): a collection, saved papers or an earlier job's included
// papers, read on the server in a fixed order, a step at a time, into one job however many
// there are (#635); and where included papers go.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { screeningPaperCredits } from "../../lib/pricing";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import { answerPaper } from "../research/answers";
import { collectionSortName } from "../library/collections";
import { setupScreeningWorkpool } from "./workpool.test-support";
import { SCREENING_POOL_SIZE } from "../workpool";
import type { SavedSearch } from "../../lib/research/records";
import { exportParts } from "../exports.test-support";
import { createJob } from "./createJob.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";
import { madeBy } from "../workspaces/actor.test-support";

const questions = [{ key: "q1", question: "Randomized?" }];
const scoringConfig = { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 1, stars: 5 }], minimumScore: 1 };
const job = { questions, scoringConfig };
const W = (i: number) => `https://openalex.org/W${i}`;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** The price of the model Screen all runs on when a person picked none, and what a paper costs at most on it. */
const PRICE = { input: 0.1, output: 0.5 };
const PER_PAPER = screeningPaperCredits(PRICE);

/** Alice, with credits, `saved` papers saved one a millisecond (W1 first), and a collection holding the first `inCollection` of them. */
async function setup({ saved = 6, inCollection = 4, credits = 100_000 } = {}) {
  const t = convexTest(schema);
  setupScreeningWorkpool(t);
  const seeded = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "alice", email: "alice@example.com", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("users", { clerkId: "bob", email: "bob@example.com", state: "active", createdAt: 1, updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId, free: credits });
    await ctx.db.insert("libraryCounts", { workspaceId: await personalWorkspaceOf(ctx, userId), count: saved });
    await ctx.db.insert("models", { modelId: SERVER_MODEL_SLUG, name: "Server model", provider: "test", inputPricePerMillion: PRICE.input, outputPricePerMillion: PRICE.output, costMarkup: 1.3, isServed: true, sortOrder: 1, supportedParameters: [], syncedAt: 1, createdAt: 1, updatedAt: 1 });
    const collectionId = await ctx.db.insert("collections", { ...(await madeBy(ctx, userId)), name: "Reading trials", sortName: collectionSortName("Reading trials"), itemCount: inCollection, createdAt: 1, updatedAt: 1 });
    for (let i = 1; i <= saved; i++) {
      const libraryItemId = await ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), openalexId: W(i), title: `Paper ${i}`, authors: ["Ada Lovelace", "Alan Turing"], abstract: "Tutoring works", journal: "A journal", citedByCount: i, publicationYear: 2020, searchableText: `Paper ${i}`, savedAt: i, updatedAt: i });
      if (i <= inCollection) await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId, assignedAt: i });
    }
    return { userId, collectionId };
  });
  const alice = t.withIdentity({ subject: "alice" });
  const results = (jobId: Id<"screeningJobs">) => t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(50));
  /** The model answers each of the job's started papers: yes for the papers in `yes`, no for the rest. */
  const answerAll = async (jobId: Id<"screeningJobs">, yes: number[], credits?: number) => {
    for (const result of await results(jobId)) {
      if (result.status !== "processing") continue;
      await t.mutation(internal.screening.mutations.handleScreeningComplete, {
        workId: result.workId ?? "work",
        context: { jobId, resultId: result._id },
        result: { kind: "success", returnValue: { responses: encodeQuestionResponseMap({ "Randomized?": yes.some((i) => W(i) === result.openalexId) }), confidences: {}, confidence: 0.8, ...(credits === undefined ? {} : { credits }) } },
      });
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  const inCollectionNow = (collectionId: Id<"collections">) =>
    t.run(async (ctx) => {
      const rows = await ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).take(50);
      return (await Promise.all(rows.map((row) => ctx.db.get("libraryItems", row.libraryItemId)))).map((item) => item!.openalexId).sort();
    });
  const read = (jobId: Id<"screeningJobs">) => alice.query(api.screening.queries.getScreeningJob, { jobId });
  /** Starts a job as Alice, and runs its reading, which the start schedules. */
  const screen = async (args: Parameters<typeof alice.action<typeof api.screening.start.screen>>[1]) => {
    const made = await alice.action(api.screening.start.screen, args);
    await t.action(internal.screening.start.read, { jobId: made.jobId });
    return made;
  };
  return { t, alice, ...seeded, results, answerAll, inCollectionNow, read, screen };
}

describe("Screen all on papers the account holds", () => {
  it("reads a range of a collection, newest saved first, with what the list shows of each paper", async () => {
    const { alice, screen, collectionId, results, read } = await setup();

    const { jobId } = await screen({ set: { kind: "collection", collectionId }, first: 2, last: 3, ...job, saveTo: { kind: "none" } });

    const papers = await results(jobId);
    expect(papers.map((paper) => paper.openalexId)).toEqual([W(3), W(2)]);
    expect(papers[0]).toMatchObject({ title: "Paper 3", abstract: "Tutoring works", authors: ["Ada Lovelace", "Alan Turing"], venue: "A journal", citedByCount: 3, publicationYear: 2020 });
    expect(await read(jobId)).toMatchObject({ set: { kind: "collection", collectionId }, label: "Reading trials", first: 2, last: 3, totalPapers: 2, unsaved: true, credits: { spent: 0, estimate: 2 * PER_PAPER } });
  });

  it("reads every saved paper, and an earlier job's included papers in that job's order", async () => {
    const { alice, screen, results, answerAll, read } = await setup();

    const first = await screen({ set: { kind: "saved" }, first: 1, last: 50, ...job, saveTo: { kind: "none" } });
    expect((await results(first.jobId)).map((paper) => paper.openalexId)).toEqual([6, 5, 4, 3, 2, 1].map(W));
    await answerAll(first.jobId, [5, 2, 1]);

    const second = await screen({ set: { kind: "screening", jobId: first.jobId }, first: 2, last: 3, ...job, saveTo: { kind: "none" } });
    expect((await results(second.jobId)).map((paper) => paper.openalexId)).toEqual([W(2), W(1)]);
    expect(await read(second.jobId)).toMatchObject({ set: { kind: "screening", jobId: first.jobId }, totalPapers: 2 });
  });

  it("keeps the name it was given, which a screening of its papers goes by (#696)", async () => {
    const { screen, collectionId, answerAll, read } = await setup();

    const named = await screen({ set: { kind: "collection", collectionId }, first: 1, last: 2, ...job, saveTo: { kind: "none" }, name: "  Pilot  " });
    expect(await read(named.jobId)).toMatchObject({ name: "Pilot", label: "Reading trials" });
    await answerAll(named.jobId, [4]);

    const again = await screen({ set: { kind: "screening", jobId: named.jobId }, first: 1, last: 1, ...job, saveTo: { kind: "none" }, name: " " });
    const ofIt = await read(again.jobId);
    expect(ofIt).toMatchObject({ label: "Pilot" });
    expect(ofIt).not.toHaveProperty("name");
  });

  it("refuses another person's collection or job, and a range with no papers", async () => {
    const { t, alice, screen, collectionId } = await setup();
    const bob = t.withIdentity({ subject: "bob" });
    const { jobId } = await screen( { set: { kind: "saved" }, first: 1, last: 2, ...job, saveTo: { kind: "none" } });

    await expect(bob.action(api.screening.start.screen, { set: { kind: "collection", collectionId }, first: 1, last: 2, ...job, saveTo: { kind: "none" } })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(bob.action(api.screening.start.screen, { set: { kind: "screening", jobId }, first: 1, last: 2, ...job, saveTo: { kind: "none" } })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(alice.action(api.screening.start.screen, { set: { kind: "collection", collectionId }, first: 9, last: 12, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/no papers in that range/);
    await expect(alice.action(api.screening.start.screen, { set: { kind: "saved" }, first: 1, last: 2, ...job, saveTo: { kind: "none" }, prune: true })).rejects.toThrow(/Only a collection/);
    await expect(alice.action(api.screening.start.screen, { set: { kind: "saved" }, first: 1, last: Infinity, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/first before the last/);
  });
});

describe("where a job's papers go", () => {
  it("saves included papers to a new collection, and takes the excluded ones from the collection it read when asked to", async () => {
    const { t, alice, screen, userId, collectionId, answerAll, inCollectionNow, read } = await setup();

    const { jobId } = await screen({ set: { kind: "collection", collectionId }, first: 1, last: 4, ...job, saveTo: { kind: "new", name: " Included trials " }, prune: true });
    await answerAll(jobId, [4, 1], 3);

    const made = await t.run(async (ctx) => { const workspaceId = await personalWorkspaceOf(ctx, userId); return ctx.db.query("collections").withIndex("by_workspace_sortName", (q) => q.eq("workspaceId", workspaceId).eq("sortName", "included trials")).unique(); });
    expect(await read(jobId)).toMatchObject({ status: "completed", targetCollectionName: "Included trials", prune: true, outcomes: { included: 2, excluded: 2 }, credits: { spent: 12, estimate: 4 * PER_PAPER }, saved: 2, removed: 2 });
    expect(await inCollectionNow(made!._id)).toEqual([W(1), W(4)]);
    expect(await inCollectionNow(collectionId)).toEqual([W(1), W(4)]);

    // A changed answer that includes a pruned paper brings it back, and saves it with the others.
    await alice.mutation(api.screening.papers.answer, { jobId, paperId: W(2), questionKey: "q1", answer: true });
    expect(await inCollectionNow(collectionId)).toEqual([W(1), W(2), W(4)]);
    expect(await inCollectionNow(made!._id)).toEqual([W(1), W(2), W(4)]);
    expect(await read(jobId)).toMatchObject({ saved: 3, removed: 1 });
    // And one that excludes a paper takes it out of the collection the job read. It stays where it was saved, so the count of saved papers stays.
    await alice.mutation(api.screening.papers.answer, { jobId, paperId: W(4), questionKey: "q1", answer: false });
    expect(await inCollectionNow(collectionId)).toEqual([W(1), W(2)]);
    expect(await inCollectionNow(made!._id)).toEqual([W(1), W(2), W(4)]);
    expect(await read(jobId)).toMatchObject({ outcomes: { included: 2 }, saved: 3, removed: 2 });
  });

  it("leaves papers it never screened in the collection when a pruning job is cancelled, and keeps what a late paper cost", async () => {
    const { t, screen, collectionId, results, inCollectionNow, read } = await setup();
    const { jobId } = await screen({ set: { kind: "collection", collectionId }, first: 1, last: 4, ...job, saveTo: { kind: "none" }, prune: true });
    const [late] = await results(jobId);

    // Cancelled while its papers are queued; one paper's answer and its charge arrive after.
    await t.run((ctx) => ctx.db.patch("screeningJobs", jobId, { status: "cancelled" }));
    await t.mutation(internal.screening.mutations.handleScreeningComplete, {
      workId: late.workId!, context: { jobId, resultId: late._id },
      result: { kind: "success", returnValue: { responses: encodeQuestionResponseMap({ "Randomized?": false }), confidences: {}, confidence: 0.8, credits: 3 } },
    });
    await t.mutation(internal.screening.mutations.endScreeningWork, { jobId, cursor: null });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await results(jobId)).map((paper) => paper.status)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(await inCollectionNow(collectionId)).toEqual([1, 2, 3, 4].map(W));
    expect(await read(jobId)).toMatchObject({ status: "cancelled", credits: { spent: 3 } });
  });

  it("keeps the paper that found the credits spent in the collection of a pruning job", async () => {
    const { t, screen, collectionId, results, inCollectionNow } = await setup();
    const { jobId } = await screen({ set: { kind: "collection", collectionId }, first: 1, last: 4, ...job, saveTo: { kind: "none" }, prune: true });
    const [unlucky] = await results(jobId);

    // As the paper's action does when the balance runs out: the job ends, then its own work fails.
    await t.mutation(internal.screening.mutations.markScreeningJobCreditsExhausted, { jobId });
    await t.mutation(internal.screening.mutations.handleScreeningComplete, { workId: unlucky.workId!, context: { jobId, resultId: unlucky._id }, result: { kind: "failed", error: "AI_INSUFFICIENT_CREDITS" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await results(jobId)).map((paper) => paper.status)).toEqual(["failed", "skipped", "skipped", "skipped"]);
    expect(await inCollectionNow(collectionId)).toEqual([1, 2, 3, 4].map(W));
  });

  it("saves nothing, and leaves the collection it read alone, when told to", async () => {
    const { t, screen, userId, collectionId, answerAll, inCollectionNow } = await setup({ saved: 0, inCollection: 0 });
    // Papers from a job, which aren't saved yet.
    const source = await t.run(async (ctx) => {
      const screeningId = await ctx.db.insert("screenings", { workspaceId: await personalWorkspaceOf(ctx, userId), version: 0, createdAt: 1 });
      const jobId = await ctx.db.insert("screeningJobs", { ...(await madeBy(ctx, userId)), status: "completed", totalPapers: 2, questions, scoringConfig, screeningId, createdAt: 1, updatedAt: 1 });
      for (const i of [1, 2]) await ctx.db.insert("screeningResults", { jobId, openalexId: W(i), title: `Paper ${i}`, status: "completed", outcome: "included", createdAt: 1 });
      return jobId;
    });

    const { jobId } = await screen({ set: { kind: "screening", jobId: source }, first: 1, last: 2, ...job, saveTo: { kind: "none" } });
    await answerAll(jobId, [1, 2]);

    expect(await t.run(async (ctx) => { const workspaceId = await personalWorkspaceOf(ctx, userId); return ctx.db.query("libraryItems").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(5); })).toEqual([]);
    expect(await inCollectionNow(collectionId)).toEqual([]);
  });
});

describe("a job of any size", () => {
  it("reads all its papers a step at a time into one job, past the old 1,000 a job held", { tags: ["size"] }, async () => {
    const { t, results, read, screen } = await setup({ saved: 1_250, inCollection: 0 });
    const { jobId } = await screen({ set: { kind: "saved" }, first: 1, last: 1_250, ...job, saveTo: { kind: "none" } });
    expect(await read(jobId)).toMatchObject({ totalPapers: 1_250 });
    expect((await read(jobId))?.reading).toBeUndefined();
    const ids = new Set((await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1_300))).map((paper) => paper.openalexId));
    expect(ids.size).toBe(1_250);
    expect((await results(jobId)).length).toBe(50);
  });

  it("stops reading where the person's credits run out, screens the papers it took, and ends out of credits", { tags: ["size"] }, async () => {
    // Enough for one step of papers, not two.
    const { t, read, screen } = await setup({ saved: 450, inCollection: 0, credits: 250 * PER_PAPER });
    const { jobId } = await screen({ set: { kind: "saved" }, first: 1, last: 450, ...job, saveTo: { kind: "none" } });
    expect(await read(jobId)).toMatchObject({ status: "processing", totalPapers: 200 });

    // The model answers each paper as it starts, until none is left.
    for (let round = 0; round < 20; round++) {
      const started = (await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(300))).filter((result) => result.status === "processing" && result.workId);
      if (!started.length) break;
      for (const result of started) {
        await t.mutation(internal.screening.mutations.handleScreeningComplete, {
          workId: result.workId!, context: { jobId, resultId: result._id },
          result: { kind: "success", returnValue: { responses: encodeQuestionResponseMap({ "Randomized?": false }), confidences: {}, confidence: 0.8, credits: 1 } },
        });
      }
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await read(jobId)).toMatchObject({ status: "creditsExhausted", totalPapers: 200, processedPapers: 200 });
  });

  it("a read that fails after earlier steps skips the papers they took that hadn't started", async () => {
    const { t, userId } = await setup({ saved: 0, inCollection: 0 });
    const papers = Array.from({ length: 200 }, (_, i) => ({ openalexId: W(i + 1), title: `Paper ${i + 1}` }));
    const { jobId } = await t.mutation(internal.screening.mutations.openScreeningJob, { userId, author: "user", set: { kind: "saved" }, first: 1, last: 400, papers: 400, ...job, saveTo: { kind: "none" } });
    await t.mutation(internal.screening.mutations.fillScreeningJob, { jobId, papers, read: 200, ended: false });
    await t.mutation(internal.screening.mutations.failScreeningRead, { jobId, reason: "OpenAlex couldn't return these papers (503)." });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(300));
    expect(results.filter((result) => result.waitingSince !== undefined)).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))?.status).toBe("failed");
  });

  it("stops reading when it's cancelled", async () => {
    const { t, alice, read } = await setup({ saved: 450, inCollection: 0 });
    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "saved" }, first: 1, last: 450, ...job, saveTo: { kind: "none" } });
    await alice.mutation(api.screening.mutations.cancelScreeningJob, { jobId });
    await t.action(internal.screening.start.read, { jobId });
    expect(await read(jobId)).toMatchObject({ status: "cancelled" });
    expect(await t.run(async (ctx) => (await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(1)).length)).toBe(0);
  });
});

describe("a job on a search whose page already answered some papers", () => {
  const search: SavedSearch = {
    id: "local-search", query: "tutoring trials", field: "title_and_abstract", count: 900,
    queryHistoryCount: 1, questionCount: 1, questionText: "", screeningQuestions: [{ question: "Randomized?" }], screeningResponses: [],
    createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", sortBy: "relevance_score:desc",
  };

  it("takes them step after step for nothing, before they're counted as done, with no credits left", async () => {
    const { t, alice, userId } = await setup({ credits: 0 });
    await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: [{ search }], shortcuts: [], ratings: [] });
    const papers = Array.from({ length: 400 }, (_, i) => ({ openalexId: W(i + 1), title: `Paper ${i + 1}` }));
    await t.run(async (ctx) => {
      const rowWorkspace = await personalWorkspaceOf(ctx, userId);
      const row = (await ctx.db.query("searches").withIndex("by_workspace_and_localId", (q) => q.eq("workspaceId", rowWorkspace).eq("localId", search.id)).unique())!;
      const screeningId = await ctx.db.insert("screenings", { workspaceId: await personalWorkspaceOf(ctx, userId), searchId: row._id, version: 0, createdAt: 1 });
      for (const paper of papers) await answerPaper(ctx, screeningId, paper.openalexId, [{ question: "Randomized?", response: true }], "model", 1);
    });

    const { jobId } = await t.mutation(internal.screening.mutations.openScreeningJob, { userId, author: "user", set: { kind: "search", searchId: search.id }, first: 1, last: 400, papers: 400, ...job, saveTo: { kind: "none" } });
    await t.mutation(internal.screening.mutations.fillScreeningJob, { jobId, papers: papers.slice(0, 200), read: 200, ended: false });
    await t.mutation(internal.screening.mutations.fillScreeningJob, { jobId, papers: papers.slice(200), read: 200, ended: true });

    const made = (await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!;
    expect(made.status).not.toBe("creditsExhausted");
    expect(made.totalPapers).toBe(400);
  });

  it("keeps those papers' answers without asking the model, and counts them", async () => {
    // Credits for the one new paper only: the two already answered cost nothing.
    const { t, alice, userId, results, answerAll, read } = await setup({ credits: PER_PAPER });
    await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: [{ search }], shortcuts: [], ratings: [] });
    const papers = [1, 2, 3].map((i) => ({ openalexId: W(i), title: `Paper ${i}` }));
    // The search's page answered W1 (by a person) and W2 (by the model); W3 is new.
    await t.run(async (ctx) => {
      const rowWorkspace = await personalWorkspaceOf(ctx, userId);
      const row = (await ctx.db.query("searches").withIndex("by_workspace_and_localId", (q) => q.eq("workspaceId", rowWorkspace).eq("localId", search.id)).unique())!;
      const screeningId = await ctx.db.insert("screenings", { workspaceId: await personalWorkspaceOf(ctx, userId), searchId: row._id, version: 0, createdAt: 1 });
      await answerPaper(ctx, screeningId, W(1), [{ question: "Randomized?", response: true }], "person", 1);
      await answerPaper(ctx, screeningId, W(2), [{ question: "Randomized?", response: false }], "model", 1);
    });

    const { jobId } = await createJob(alice, { papers, set: { kind: "search", searchId: search.id }, ...job, saveTo: { kind: "none" } });

    // Only the new paper took a slot; the estimate covers it alone.
    expect((await results(jobId)).map((paper) => [paper.status, paper.workId === undefined])).toEqual([["completed", true], ["completed", true], ["processing", false]]);
    expect(await read(jobId)).toMatchObject({ label: "tutoring trials", running: 1, credits: { estimate: PER_PAPER } });

    await answerAll(jobId, [3]);
    expect(await read(jobId)).toMatchObject({ status: "completed", running: 0, outcomes: { included: 2, excluded: 1, unclear: 0, failed: 0 }, tallies: [{ key: "q1", yes: 2, no: 1, unclear: 0 }] });
    expect(await alice.query(api.screening.queries.slots, {})).toEqual({ limit: SCREENING_POOL_SIZE, running: 0 });
    const exported = JSON.parse((await exportParts(t, alice, { kind: "screening", jobId })).text);
    expect(exported.results[0]).toMatchObject({ answers: { q1: true }, modelAnswers: {}, decisions: { q1: { by: "person" } } });
    expect(exported.results[0].modelAnswers).toEqual({});
    expect(exported.results[1]).toMatchObject({ answers: { q1: false }, modelAnswers: { q1: false } });
  });
});
