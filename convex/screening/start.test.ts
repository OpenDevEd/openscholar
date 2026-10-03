// Screen all on any paper set (#341): a collection, saved papers or an earlier job's included
// papers, read on the server in a fixed order; where included papers go; and a request too
// big for one job running as several, one after another.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import { answerPaper } from "../research/answers";
import { collectionSortName } from "../library/collections";
import { setupScreeningWorkpool } from "./workpool.test-support";
import type { SavedSearch } from "../../lib/research/records";

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

/** Alice, with credits, `saved` papers saved one a millisecond (W1 first), and a collection holding the first `inCollection` of them. */
async function setup({ saved = 6, inCollection = 4, credits = 100_000 } = {}) {
  const t = convexTest(schema);
  setupScreeningWorkpool(t);
  const seeded = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { libraryItemCount: saved, clerkId: "alice", email: "alice@example.com", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "bob", email: "bob@example.com", state: "active", createdAt: 1, updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId, free: credits });
    const collectionId = await ctx.db.insert("collections", { userId, name: "Reading trials", sortName: collectionSortName("Reading trials"), itemCount: inCollection, createdAt: 1, updatedAt: 1 });
    for (let i = 1; i <= saved; i++) {
      const libraryItemId = await ctx.db.insert("libraryItems", { userId, openalexId: W(i), title: `Paper ${i}`, authors: "Ada Lovelace, Alan Turing", abstract: "Tutoring works", journal: "A journal", citedByCount: i, publicationYear: 2020, searchableText: `Paper ${i}`, savedAt: i, updatedAt: i });
      if (i <= inCollection) await ctx.db.insert("libraryItemCollections", { userId, collectionId, libraryItemId, assignedAt: i });
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
  return { t, alice, ...seeded, results, answerAll, inCollectionNow, read };
}

describe("Screen all on papers the account holds", () => {
  it("reads a range of a collection, newest saved first, with what the list shows of each paper", async () => {
    const { alice, collectionId, results, read } = await setup();

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "collection", collectionId }, first: 2, last: 3, ...job, saveTo: { kind: "none" } });

    const papers = await results(jobId);
    expect(papers.map((paper) => paper.openalexId)).toEqual([W(3), W(2)]);
    expect(papers[0]).toMatchObject({ title: "Paper 3", abstract: "Tutoring works", authors: ["Ada Lovelace", "Alan Turing"], venue: "A journal", citedByCount: 3, publicationYear: 2020 });
    expect(await read(jobId)).toMatchObject({ set: { kind: "collection", collectionId }, label: "Reading trials", first: 2, last: 3, totalPapers: 2, unsaved: true, credits: { spent: 0, estimate: 9 } });
  });

  it("reads every saved paper, and an earlier job's included papers in that job's order", async () => {
    const { alice, results, answerAll, read } = await setup();

    const first = await alice.action(api.screening.start.screen, { set: { kind: "saved" }, first: 1, last: 50, ...job, saveTo: { kind: "none" } });
    expect((await results(first.jobId)).map((paper) => paper.openalexId)).toEqual([6, 5, 4, 3, 2, 1].map(W));
    await answerAll(first.jobId, [5, 2, 1]);

    const second = await alice.action(api.screening.start.screen, { set: { kind: "screening", jobId: first.jobId }, first: 2, last: 3, ...job, saveTo: { kind: "none" } });
    expect((await results(second.jobId)).map((paper) => paper.openalexId)).toEqual([W(2), W(1)]);
    expect(await read(second.jobId)).toMatchObject({ set: { kind: "screening", jobId: first.jobId }, totalPapers: 2 });
  });

  it("refuses another person's collection or job, and a range with no papers", async () => {
    const { t, alice, collectionId } = await setup();
    const bob = t.withIdentity({ subject: "bob" });
    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "saved" }, first: 1, last: 2, ...job, saveTo: { kind: "none" } });

    await expect(bob.action(api.screening.start.screen, { set: { kind: "collection", collectionId }, first: 1, last: 2, ...job, saveTo: { kind: "none" } })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(bob.action(api.screening.start.screen, { set: { kind: "screening", jobId }, first: 1, last: 2, ...job, saveTo: { kind: "none" } })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(alice.action(api.screening.start.screen, { set: { kind: "collection", collectionId }, first: 9, last: 12, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/no papers in that range/);
    await expect(alice.action(api.screening.start.screen, { set: { kind: "saved" }, first: 1, last: 2, ...job, saveTo: { kind: "none" }, prune: true })).rejects.toThrow(/Only a collection/);
    await expect(alice.action(api.screening.start.screen, { set: { kind: "saved" }, first: 1, last: Infinity, ...job, saveTo: { kind: "none" } })).rejects.toThrow(/first before the last/);
  });
});

describe("where a job's papers go", () => {
  it("saves included papers to a new collection, and takes the excluded ones from the collection it read when asked to", async () => {
    const { t, alice, userId, collectionId, answerAll, inCollectionNow, read } = await setup();

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "collection", collectionId }, first: 1, last: 4, ...job, saveTo: { kind: "new", name: " Included trials " }, prune: true });
    await answerAll(jobId, [4, 1], 3);

    const made = await t.run((ctx) => ctx.db.query("collections").withIndex("by_user_sortName", (q) => q.eq("userId", userId).eq("sortName", "included trials")).unique());
    expect(await read(jobId)).toMatchObject({ status: "completed", targetCollectionName: "Included trials", prune: true, outcomes: { included: 2, excluded: 2 }, credits: { spent: 12, estimate: 18 } });
    expect(await inCollectionNow(made!._id)).toEqual([W(1), W(4)]);
    expect(await inCollectionNow(collectionId)).toEqual([W(1), W(4)]);

    // A changed answer that includes a pruned paper brings it back, and saves it with the others.
    await alice.mutation(api.screening.papers.answer, { jobId, paperId: W(2), questionKey: "q1", answer: true });
    expect(await inCollectionNow(collectionId)).toEqual([W(1), W(2), W(4)]);
    expect(await inCollectionNow(made!._id)).toEqual([W(1), W(2), W(4)]);
    // And one that excludes a paper takes it out.
    await alice.mutation(api.screening.papers.answer, { jobId, paperId: W(4), questionKey: "q1", answer: false });
    expect(await inCollectionNow(collectionId)).toEqual([W(1), W(2)]);
  });

  it("leaves papers it never screened in the collection when a pruning job is cancelled, and keeps what a late paper cost", async () => {
    const { t, alice, collectionId, results, inCollectionNow, read } = await setup();
    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "collection", collectionId }, first: 1, last: 4, ...job, saveTo: { kind: "none" }, prune: true });
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
    const { t, alice, collectionId, results, inCollectionNow } = await setup();
    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "collection", collectionId }, first: 1, last: 4, ...job, saveTo: { kind: "none" }, prune: true });
    const [unlucky] = await results(jobId);

    // As the paper's action does when the balance runs out: the job ends, then its own work fails.
    await t.mutation(internal.screening.mutations.markScreeningJobCreditsExhausted, { jobId });
    await t.mutation(internal.screening.mutations.handleScreeningComplete, { workId: unlucky.workId!, context: { jobId, resultId: unlucky._id }, result: { kind: "failed", error: "AI_INSUFFICIENT_CREDITS" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await results(jobId)).map((paper) => paper.status)).toEqual(["failed", "skipped", "skipped", "skipped"]);
    expect(await inCollectionNow(collectionId)).toEqual([1, 2, 3, 4].map(W));
  });

  it("saves nothing, and leaves the collection it read alone, when told to", async () => {
    const { t, alice, userId, collectionId, answerAll, inCollectionNow } = await setup({ saved: 0, inCollection: 0 });
    // Papers from a job, which aren't saved yet.
    const source = await t.run(async (ctx) => {
      const screeningId = await ctx.db.insert("screenings", { userId, version: 0, createdAt: 1 });
      const jobId = await ctx.db.insert("screeningJobs", { userId, status: "completed", totalPapers: 2, questions, scoringConfig, screeningId, createdAt: 1, updatedAt: 1 });
      for (const i of [1, 2]) await ctx.db.insert("screeningResults", { jobId, openalexId: W(i), title: `Paper ${i}`, status: "completed", outcome: "included", createdAt: 1 });
      return jobId;
    });

    const { jobId } = await alice.action(api.screening.start.screen, { set: { kind: "screening", jobId: source }, first: 1, last: 2, ...job, saveTo: { kind: "none" } });
    await answerAll(jobId, [1, 2]);

    expect(await t.run((ctx) => ctx.db.query("libraryItems").withIndex("by_user", (q) => q.eq("userId", userId)).take(5))).toEqual([]);
    expect(await inCollectionNow(collectionId)).toEqual([]);
  });
});

describe("a request bigger than one job", () => {
  it("starts the job for the next papers when one completes, with the same questions, rules and destination", async () => {
    const { t, userId, collectionId, results, answerAll } = await setup();
    // One job holds 1,000 papers, so a small request is cut by hand: papers 1 to 2 of a request through 5.
    const papers = [6, 5].map((i) => ({ openalexId: W(i), title: `Paper ${i}` }));
    const first = await t.mutation(internal.screening.mutations.createScreeningJobForUser, { userId, author: "user", papers, set: { kind: "saved" }, first: 1, last: 2, through: 5, ...job, saveTo: { kind: "collection", collectionId } });
    const jobs = () => t.run((ctx) => ctx.db.query("screeningJobs").withIndex("by_user", (q) => q.eq("userId", userId)).order("asc").take(10));

    await answerAll(first.jobId, []);
    const [, second] = await jobs();
    expect(second).toMatchObject({ set: { kind: "saved" }, first: 3, last: 5, totalPapers: 3, targetCollectionId: collectionId, questions, scoringConfig });
    expect(second.through).toBeUndefined();
    expect((await results(second._id)).map((paper) => paper.openalexId)).toEqual([4, 3, 2].map(W));

    await answerAll(second._id, []);
    expect(await jobs()).toHaveLength(2);
  });

  it("reads on from where the last job stopped, so a collection it prunes keeps its unread papers in place", async () => {
    const { t, userId, collectionId, results, answerAll, inCollectionNow } = await setup();
    // The first job as `screen` makes it for a request through paper 4: papers 1 to 2, and where the collection goes on.
    const head = await t.query(internal.paperSets.held.page, { userId, set: { kind: "collection", collectionId }, cursor: null, numItems: 2 });
    const first = await t.mutation(internal.screening.mutations.createScreeningJobForUser, {
      userId, author: "user", papers: head.page, set: { kind: "collection", collectionId }, first: 1, last: 2, through: 4, resume: head.continueCursor, ...job, saveTo: { kind: "none" }, prune: true,
    });

    // Both excluded (W4 and W3, the newest saved): they leave the collection, which now holds only the two papers still to come.
    await answerAll(first.jobId, []);
    const [, second] = await t.run((ctx) => ctx.db.query("screeningJobs").withIndex("by_user", (q) => q.eq("userId", userId)).order("asc").take(10));
    expect((await results(second._id)).map((paper) => paper.openalexId)).toEqual([W(2), W(1)]);
    expect(second).toMatchObject({ first: 3, last: 4, prune: true });
    expect(await inCollectionNow(collectionId)).toEqual(expect.not.arrayContaining([W(3), W(4)]));
  });

  it("ends with a job that's cancelled", async () => {
    const { t, alice, userId } = await setup();
    const papers = [6, 5].map((i) => ({ openalexId: W(i), title: `Paper ${i}` }));
    const { jobId } = await t.mutation(internal.screening.mutations.createScreeningJobForUser, { userId, author: "user", papers, set: { kind: "saved" }, first: 1, last: 2, through: 5, ...job });

    await alice.mutation(api.screening.mutations.cancelScreeningJob, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run((ctx) => ctx.db.query("screeningJobs").withIndex("by_user", (q) => q.eq("userId", userId)).take(10))).toHaveLength(1);
  });

  it("shows where the request stopped when the person can't pay for its next job", async () => {
    const { t, userId, answerAll } = await setup({ credits: 10 });
    const papers = [6, 5].map((i) => ({ openalexId: W(i), title: `Paper ${i}` }));
    const first = await t.mutation(internal.screening.mutations.createScreeningJobForUser, { userId, author: "user", papers, set: { kind: "saved" }, first: 1, last: 2, through: 5, ...job });

    await answerAll(first.jobId, []);

    const [, second] = await t.run((ctx) => ctx.db.query("screeningJobs").withIndex("by_user", (q) => q.eq("userId", userId)).order("asc").take(10));
    expect(second).toMatchObject({ status: "creditsExhausted", first: 3, last: 5, totalPapers: 3 });
  });
});

describe("a job on a search whose page already answered some papers", () => {
  const search: SavedSearch = {
    id: "local-search", query: "tutoring trials", field: "title_and_abstract", count: 900,
    queryHistoryCount: 1, questionCount: 1, questionText: "", screeningQuestions: [{ question: "Randomized?" }], screeningResponses: [],
    createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", sortBy: "relevance_score:desc",
  };

  it("keeps those papers' answers without asking the model, and counts them", async () => {
    // Credits for the one new paper only: the two already answered cost nothing.
    const { t, alice, userId, results, answerAll, read } = await setup({ credits: 5 });
    await alice.mutation(api.research.records.importBatch, { accountId: "alice", searches: [{ search }], shortcuts: [], ratings: [] });
    const papers = [1, 2, 3].map((i) => ({ openalexId: W(i), title: `Paper ${i}` }));
    // The search's page answered W1 (by a person) and W2 (by the model); W3 is new.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("searches").withIndex("by_user_and_localId", (q) => q.eq("userId", userId).eq("localId", search.id)).unique())!;
      const screeningId = await ctx.db.insert("screenings", { userId, searchId: row._id, version: 0, createdAt: 1 });
      await answerPaper(ctx, screeningId, W(1), [{ question: "Randomized?", response: true }], "person", 1);
      await answerPaper(ctx, screeningId, W(2), [{ question: "Randomized?", response: false }], "model", 1);
    });

    // What `screen` counts before it makes the job, so the credit check leaves these papers out.
    expect(await t.query(internal.screening.queries.answeredCount, { userId, searchId: search.id, questions: ["Randomized?"], paperIds: papers.map((paper) => paper.openalexId) })).toBe(2);
    const { jobId } = await t.mutation(internal.screening.mutations.createScreeningJobForUser, { userId, author: "user", papers, set: { kind: "search", searchId: search.id }, first: 1, last: 3, answered: 2, ...job, saveTo: { kind: "none" } });

    // Only the new paper took a slot; the estimate covers it alone.
    expect((await results(jobId)).map((paper) => [paper.status, paper.workId === undefined])).toEqual([["completed", true], ["completed", true], ["processing", false]]);
    expect(await read(jobId)).toMatchObject({ label: "tutoring trials", running: 1, credits: { estimate: 5 } });

    await answerAll(jobId, [3]);
    expect(await read(jobId)).toMatchObject({ status: "completed", running: 0, outcomes: { included: 2, excluded: 1, unclear: 0, failed: 0 }, tallies: [{ key: "q1", yes: 2, no: 1, unclear: 0 }] });
    expect(await alice.query(api.screening.queries.slots, {})).toEqual({ limit: 20, running: 0 });
  });
});
