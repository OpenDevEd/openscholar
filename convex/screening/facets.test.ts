// The counts Papers narrows by (./facets.ts) agree with the votes and cards they count, read whole, as papers move
// between reviewers, are voted on and settled.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { tallyOfReviewer, type Way } from "./facets";
import { runAll, started, team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const WAYS: Way[] = ["include", "maybe", "exclude", "waiting", "failed"];

it("keeps a reviewer's counts with the papers moved to them, voted on and settled", async () => {
  const made = await team(["ann", "ben"]);
  const { t, workspaceId } = made;
  // One person on each paper, so papers can be moved from one to the other.
  const { jobId, papers } = await started(made, ["ann", "ben"], 8, { rule: { each: 1, settle: "all", blind: "after" } });
  const rows = await t.run(async (ctx) => (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).filter((one) => one.kind === "person"));
  const [ann, ben] = [rows.find((one) => one.userId === made.ids.ann)!, rows.find((one) => one.userId === made.ids.ben)!];

  /** Each way a reviewer stands, counted as the facets count it and as their votes and the cards say it. */
  const agree = async () => {
    await runAll(t, vi.runAllTimers);
    for (const reviewer of [ann, ben]) {
      for (const way of WAYS) {
        const [counted, read] = await t.run(async (ctx) => {
          const votes = (await ctx.db.query("screeningVotes").withIndex("by_result").collect()).filter((vote) => vote.reviewerId === reviewer._id && (vote.status === "cast" ? vote.decision : vote.status) === way);
          const tally = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
          for (const vote of votes) {
            const card = await ctx.db.query("screeningCards").withIndex("by_result", (q) => q.eq("resultId", vote.resultId)).unique();
            if (card && !card.withdrawn) tally[card.result]++;
          }
          return [await tallyOfReviewer(ctx, reviewer._id, [way]), tally];
        });
        expect({ reviewer: reviewer.userId, way, ...counted }).toEqual({ reviewer: reviewer.userId, way, ...read });
      }
    }
  };
  await agree();

  // Two of Ann's papers go to Ben: only who is on them changes.
  await made.as.ann!.mutation(api.screening.reviewers.move, { workspaceId, jobId, from: ann._id, to: ben._id, papers: 2 });
  await agree();

  // Ben votes on what he has, and the papers are settled on his votes.
  const theirs = await t.run(async (ctx) => (await ctx.db.query("screeningVotes").withIndex("by_result").collect()).filter((vote) => vote.reviewerId === ben._id && vote.status === "waiting").map((vote) => vote.resultId as Id<"screeningResults">));
  await made.as.ben!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: theirs.slice(0, 2), decision: "include" });
  await made.as.ben!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: theirs.slice(2), decision: "exclude", reason: "other" });
  await agree();
  expect(papers).toHaveLength(8);
});
