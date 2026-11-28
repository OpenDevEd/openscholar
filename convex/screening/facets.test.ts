// The counts Papers narrows by (./facets.ts) agree with the votes and cards they count, read whole, as papers move
// between reviewers, are voted on and settled.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { recountVote, tallyOfReviewer, type Way } from "./facets";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { runAll, started, team, type Team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const WAYS: Way[] = ["include", "maybe", "exclude", "cast", "waiting", "failed"];

/** Each way each reviewer stands, counted as the facets count it and as their votes and the cards say it, read whole. */
async function agree(t: Team["t"], reviewers: Id<"screeningReviewers">[]) {
  await runAll(t, vi.runAllTimers);
  for (const reviewer of reviewers) {
    for (const way of WAYS) {
      const [counted, read] = await t.run(async (ctx) => {
        const votes = (await ctx.db.query("screeningVotes").withIndex("by_result").collect()).filter((vote) => vote.reviewerId === reviewer && (vote.status === "cast" ? (vote.decision ?? "cast") : vote.status) === way);
        const tally = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
        for (const vote of votes) {
          const card = await ctx.db.query("screeningCards").withIndex("by_result", (q) => q.eq("resultId", vote.resultId)).unique();
          if (card && !card.withdrawn) tally[card.result]++;
        }
        return [await tallyOfReviewer(ctx, reviewer, [way]), tally];
      });
      expect({ reviewer, way, ...counted }).toEqual({ reviewer, way, ...read });
    }
  }
}

it("keeps a reviewer's counts with the papers moved to them, voted on and settled", async () => {
  const made = await team(["ann", "ben"]);
  const { t, workspaceId } = made;
  // One person on each paper, so papers can be moved from one to the other.
  const { jobId, papers } = await started(made, ["ann", "ben"], 8, { rule: { each: 1, settle: "all", blind: "after" } });
  const rows = await t.run(async (ctx) => (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).filter((one) => one.kind === "person"));
  const [ann, ben] = [rows.find((one) => one.userId === made.ids.ann)!, rows.find((one) => one.userId === made.ids.ben)!];

  const agreed = () => agree(t, [ann._id, ben._id]);
  await agreed();

  // Two of Ann's papers go to Ben: only who is on them changes.
  await made.as.ann!.mutation(api.screening.reviewers.move, { workspaceId, jobId, from: ann._id, to: ben._id, papers: 2 });
  await agreed();

  // Ben votes on what he has, and the papers are settled on his votes.
  const theirs = await t.run(async (ctx) => (await ctx.db.query("screeningVotes").withIndex("by_result").collect()).filter((vote) => vote.reviewerId === ben._id && vote.status === "waiting").map((vote) => vote.resultId as Id<"screeningResults">));
  await made.as.ben!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: theirs.slice(0, 2), decision: "include" });
  await made.as.ben!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: theirs.slice(2), decision: "exclude", reason: "other" });
  await agreed();
  expect(papers).toHaveLength(8);
});

it("keeps a model's counts as its readings come back from the pool, failed or read", async () => {
  const made = await team(["ann"]);
  const { t } = made;
  const { jobId, papers } = await started(made, ["ann"], 2, { rule: { each: 1, settle: "all", blind: "after" } });
  // A model on both papers, each reading out in the pool.
  const model = await t.run(async (ctx) => {
    const reviewerId = await ctx.db.insert("screeningReviewers", { jobId, kind: "model", addedAt: 1, addedBy: made.ids.ann!, dealt: 2 });
    for (const [place, paper] of papers.entries()) await ctx.db.insert("screeningVotes", { jobId, resultId: paper._id, reviewerId, place, status: "waiting", workId: `reading ${place}` });
    return reviewerId;
  });
  await agree(t, [model]);
  // The pool's completion is its own mutation: its writes reach the counts too.
  await t.mutation(internal.screening.readings.done, { workId: "reading 0", context: {}, result: { kind: "failed", error: "The model gave no answer" } } as never);
  await t.mutation(internal.screening.readings.done, { workId: "reading 1", context: {}, result: { kind: "success", returnValue: { read: true, answers: {}, confidences: {}, credits: 3 } } } as never);
  const statuses = await t.run(async (ctx) => (await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place").collect()).filter((vote) => vote.reviewerId === model).map((vote) => vote.status).sort());
  expect(statuses).not.toEqual(["waiting", "waiting"]);
  await agree(t, [model]);
});

it("takes out the waiting count a reading left when it came back without the triggers, and verify finds none left", async () => {
  const made = await team(["ann"]);
  const { t } = made;
  const { jobId, papers } = await started(made, ["ann"], 1, { rule: { each: 1, settle: "all", blind: "after" } });
  const vote = await t.run(async (ctx) => {
    const reviewerId = await ctx.db.insert("screeningReviewers", { jobId, kind: "model", addedAt: 1, addedBy: made.ids.ann!, dealt: 1 });
    return { reviewerId, id: await ctx.db.insert("screeningVotes", { jobId, resultId: papers[0]!._id, reviewerId, place: 0, status: "waiting", workId: "reading" }) };
  });
  await runAll(t, vi.runAllTimers);
  // As the pool's completion wrote it before it ran with the triggers: cast, and still counted as waiting.
  await runUntriggered(t, (ctx) => ctx.db.patch("screeningVotes", vote.id, { status: "cast", decision: "include", at: 5 }));
  const wrong = async () => t.query(internal.migrations.screeningFacets.verifyPage, { table: "screeningVotes", cursor: null });
  expect((await wrong()).missing).toBeGreaterThan(0);
  await t.run(async (ctx) => recountVote(ctx, (await ctx.db.get("screeningVotes", vote.id))!, await ctx.db.get("screeningResults", papers[0]!._id)));
  await agree(t, [vote.reviewerId]);
  expect((await wrong()).missing).toBe(0);
});

it("takes out the waiting count a reading left on a vote that has waited again since, under where its paper stands now", async () => {
  const made = await team(["ann"]);
  const { t } = made;
  const { jobId, papers } = await started(made, ["ann"], 1, { rule: { each: 1, settle: "all", blind: "after" } });
  const paperId = papers[0]!._id;
  const vote = await t.run(async (ctx) => {
    const reviewerId = await ctx.db.insert("screeningReviewers", { jobId, kind: "model", addedAt: 1, addedBy: made.ids.ann!, dealt: 1 });
    return { reviewerId, id: await ctx.db.insert("screeningVotes", { jobId, resultId: paperId, reviewerId, place: 0, status: "waiting", workId: "reading" }) };
  });
  await runAll(t, vi.runAllTimers);
  // Cast without the triggers, as the pool wrote it; its paper then goes into conflict, and a new criterion asks the model to read it again.
  await runUntriggered(t, (ctx) => ctx.db.patch("screeningVotes", vote.id, { status: "cast", at: 5 }));
  await t.run((ctx) => ctx.db.patch("screeningResults", paperId, { result: "conflict" }));
  await t.run((ctx) => ctx.db.patch("screeningVotes", vote.id, { status: "waiting", at: undefined }));
  await runAll(t, vi.runAllTimers);
  const wrong = async () => (await t.query(internal.migrations.screeningFacets.verifyPage, { table: "screeningVotes", cursor: null })).missing;
  expect(await wrong()).toBeGreaterThan(0);
  await t.run(async (ctx) => recountVote(ctx, (await ctx.db.get("screeningVotes", vote.id))!, await ctx.db.get("screeningResults", paperId)));
  await agree(t, [vote.reviewerId]);
  expect(await wrong()).toBe(0);
});
