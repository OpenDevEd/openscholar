/**
 * Who a screening's papers go to (plans/screening-reviewers). A paper is given to its reviewers as a row each in
 * `screeningVotes`: so many of the people, taken in turn, and every model. This is the one place rows are made
 * for a paper, when it arrives and whenever the people, the models or the rule change.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fillPlaces, firstDeal, readersFor } from "../../lib/screening/rules";

type Reviewer = Doc<"screeningReviewers">;
type Vote = Doc<"screeningVotes">;

/** The most reviewers a screening has, people who left it included: its lists read that many. */
export const MAX_REVIEWERS = 200;

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
const personRow = (job: Doc<"screeningJobs">, paper: Pick<Doc<"screeningResults">, "_id" | "place">, reviewer: Reviewer) => ({ jobId: job._id, resultId: paper._id, reviewerId: reviewer._id, place: paper.place ?? 0, status: "waiting" as const, lean: 0 });

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

/**
 * Brings an open paper's places in step with the people and the rule as they are now, and says which rows it made
 * and which it took away. A vote is never taken off a paper: whoever voted stays on it. A place nobody voted from
 * is kept by whoever holds it while they are on the screening, the places the rule no longer asks for go, and the
 * ones it still lacks go to the people not on the paper yet. With `models`, every model reading the screening that
 * has no row on the paper gets one: asked for when settled papers are checked again, since a model added to a
 * running screening passes over the papers that were settled then.
 */
export async function dealOpen(ctx: MutationCtx, job: Doc<"screeningJobs">, paper: Doc<"screeningResults">, votes: Vote[], reviewers: Reviewer[], { models }: { models: boolean }): Promise<{ made: Vote[]; gone: Vote[] }> {
  const byId = new Map(reviewers.map((one) => [one._id, one]));
  const people = reviewers.filter(dealable);
  const personVotes = votes.filter((vote) => byId.get(vote.reviewerId)?.kind === "person");
  const made: Vote[] = [];
  const gone: Vote[] = [];
  const insert = async (row: ReturnType<typeof modelRow>) => made.push((await ctx.db.get("screeningVotes", await ctx.db.insert("screeningVotes", row)))!);
  const remove = async (vote: Vote) => {
    await ctx.db.delete("screeningVotes", vote._id);
    gone.push(vote);
  };
  // A place whose holder has left the screening is free again.
  const open = personVotes.filter((vote) => vote.status === "waiting" || vote.status === "closed");
  for (const vote of open.filter((one) => !dealable(byId.get(one.reviewerId)!))) await remove(vote);
  const held = open.filter((vote) => dealable(byId.get(vote.reviewerId)!));
  for (const vote of held.filter((one) => one.status === "closed")) await ctx.db.patch("screeningVotes", vote._id, { status: "waiting" });
  // Whoever voted counts toward the rule's number, though they have since left. The places still free are for the people who haven't.
  const cast = personVotes.filter((vote) => vote.status === "cast");
  const free = Math.max(0, Math.min(people.length - cast.filter((vote) => dealable(byId.get(vote.reviewerId)!)).length, readersFor(job.rule!.each, Infinity) - cast.length));
  // More places than the rule asks for: the ones dealt last go.
  for (const vote of held.slice(free)) await remove(vote);
  const on = personVotes.filter((vote) => !gone.includes(vote)).map((vote) => vote.reviewerId as string);
  for (const person of fillPlaces(people.map((one) => ({ id: one._id as string, row: one })), on, (paper.away ?? []) as string[], free - Math.min(held.length, free), paper.place ?? 0)) await insert(personRow(job, paper, person.row));
  if (models) for (const model of reviewers.filter(readingModel)) if (!votes.some((vote) => vote.reviewerId === model._id)) await insert(modelRow(job, paper, model));
  return { made, gone };
}
