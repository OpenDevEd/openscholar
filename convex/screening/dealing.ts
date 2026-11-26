/**
 * Who a screening's papers go to (plans/screening-reviewers). A paper is given to its reviewers as a row each in
 * `screeningVotes`: so many of the people, taken in turn, and every model. This is the one place rows are made
 * for a paper, when it arrives and whenever the people, the models or the rule change.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { firstDeal } from "../../lib/screening/rules";
import { MAX_REVIEWERS, MAX_SOURCE_ROWS } from "./validators";

type Reviewer = Doc<"screeningReviewers">;

export { MAX_REVIEWERS, MAX_SOURCE_ROWS };

/** Everyone's place on one paper. */
export const votesOf = (ctx: Pick<QueryCtx, "db">, resultId: Id<"screeningResults">) => ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", resultId)).take(MAX_REVIEWERS);
/** A screening's sources in the order they were added, the ones taken out included. */
export const sourcesOf = (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) => ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(MAX_SOURCE_ROWS);

/** A screening's reviewers in the order they were added, whoever has left included. */
export const reviewersOf = (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) => ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(MAX_REVIEWERS);

/** The people papers are dealt to: on the screening, with an account. Someone invited by email is dealt none until they join. */
export const dealable = (reviewer: Reviewer) => reviewer.kind === "person" && reviewer.userId !== undefined && reviewer.left === undefined;
export const readingModel = (reviewer: Reviewer) => reviewer.kind === "model" && reviewer.left === undefined;

/** Whether a screening's models may take papers now: not while they are paused, it is finished, or its workspace is out of credits. */
export const modelsFree = (job: Doc<"screeningJobs">) => !job.paused && !job.outOfCredits && job.finishedAt === undefined;

/** A model's row on a paper: waiting for one of its workspace's slots, oldest screening first, unless the models are held. */
export const modelRow = (job: Doc<"screeningJobs">, paper: Pick<Doc<"screeningResults">, "_id" | "place">, reviewer: Reviewer) => ({
  jobId: job._id,
  resultId: paper._id,
  reviewerId: reviewer._id,
  place: paper.place ?? 0,
  status: "waiting" as const,
  ...(modelsFree(job) ? { waitingWorkspace: job.workspaceId, waitingSince: job.createdAt } : {}),
});
// `lean` starts at none of its models: every waiting place has a number, so the index that orders by it holds them all.
export const personRow = (job: Doc<"screeningJobs">, paper: Pick<Doc<"screeningResults">, "_id" | "place">, reviewer: Reviewer) => ({ jobId: job._id, resultId: paper._id, reviewerId: reviewer._id, place: paper.place ?? 0, status: "waiting" as const, lean: 0 });

/**
 * Gives a paper that just arrived to its reviewers, and says how many rows each got, for the caller to add to
 * their `dealt` once for the whole step.
 */
export async function dealNew(ctx: MutationCtx, job: Doc<"screeningJobs">, paper: Pick<Doc<"screeningResults">, "_id" | "place">, reviewers: Reviewer[], dealt: Map<Id<"screeningReviewers">, number>) {
  const people = reviewers.filter(dealable);
  const give = [...firstDeal(people, job.rule!.each, paper.place ?? 0).map((one) => personRow(job, paper, one)), ...reviewers.filter(readingModel).map((one) => modelRow(job, paper, one))];
  for (const row of give) {
    await ctx.db.insert("screeningVotes", row);
    dealt.set(row.reviewerId, (dealt.get(row.reviewerId) ?? 0) + 1);
  }
}

/** Adds what a step dealt to each reviewer's count of papers. */
export async function countDealt(ctx: MutationCtx, dealt: Map<Id<"screeningReviewers">, number>) {
  for (const [reviewerId, more] of dealt) {
    const reviewer = more ? await ctx.db.get("screeningReviewers", reviewerId) : null;
    if (reviewer) await ctx.db.patch("screeningReviewers", reviewerId, { dealt: Math.max(0, reviewer.dealt + more) });
  }
}
