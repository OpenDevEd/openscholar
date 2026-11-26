/**
 * A person's votes in a screening with reviewers (plans/screening-reviewers): their vote on a paper, and the
 * decision of whoever settles its conflicts. Each writes its own row and stamps the paper for the bookkeeping
 * worker, which alone works out where the paper stands (./settling.ts).
 */
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { workspaceMutation } from "../lib/userActions";
import type { InWorkspace } from "../workspaces/actor";
import { OTHER_REASONS, type Answer } from "../../lib/screening/rules";
import { requireReviewer, standingOn } from "./access";
import { bookkeepLater } from "./bookkeeping";
import { countDealt, votesOf } from "./dealing";
import { decisionValidator, SCREENING_TEXT, voteAnswersValidator } from "./validators";

/** A paper of a screening, by its ID there. */
async function paperOf(ctx: Pick<MutationCtx, "db">, jobId: Id<"screeningJobs">, resultId: Id<"screeningResults">) {
  const paper = await ctx.db.get("screeningResults", resultId);
  if (paper?.jobId !== jobId) throw createError("NOT_FOUND", "Paper not found");
  return paper;
}

/** Stamps a paper for the bookkeeping worker. A person's vote or decision lets go of a result held through a change of settings. */
export async function settleLater(ctx: MutationCtx, resultId: Id<"screeningResults">, reopen?: "vote" | "recheck") {
  await ctx.db.patch("screeningResults", resultId, { doneAt: ctx.db.vars.commitTs, ...(reopen ? { reopen } : {}) });
  await bookkeepLater(ctx);
}

/** A reason to exclude is one of the screening's criteria, or one of the others. */
function requireReason(job: Doc<"screeningJobs">, reason: string | undefined) {
  if (reason !== undefined && !job.criteria?.some((criterion) => criterion.key === reason) && !(OTHER_REASONS as readonly string[]).includes(reason)) throw createError("VALIDATION_ERROR", "Pick one of the reasons listed.");
}

const voteArgs = { jobId: v.id("screeningJobs"), paperId: v.id("screeningResults"), decision: v.union(decisionValidator, v.null()), answers: v.optional(voteAnswersValidator), reason: v.optional(v.string()), note: v.optional(v.string()) };

/** One person's vote on one paper, or their vote taken back. */
async function cast(ctx: MutationCtx, actor: InWorkspace, { jobId, paperId, decision, answers, reason, note }: { jobId: Id<"screeningJobs">; paperId: Id<"screeningResults">; decision: "include" | "maybe" | "exclude" | null; answers?: Record<string, Answer>; reason?: string; note?: string }) {
  const { job, reviewer } = await requireReviewer(ctx, actor, jobId);
  const paper = await paperOf(ctx, jobId, paperId);
  requireReason(job, reason);
  if (decision === "exclude" && !reason) throw createError("VALIDATION_ERROR", "Say why the paper is excluded.");
  if ((note?.length ?? 0) > SCREENING_TEXT.voteNote) throw createError("VALIDATION_ERROR", "That note is too long.");
  const mine = (await votesOf(ctx, paperId)).find((vote) => vote.reviewerId === reviewer._id);
  if (decision === null) {
    // Taken back: the place is theirs again to vote from.
    if (mine?.status !== "cast") return;
    await ctx.db.patch("screeningVotes", mine._id, { status: "waiting", decision: undefined, answers: undefined, reason: undefined, note: undefined, at: undefined, flagged: undefined });
    return void (await settleLater(ctx, paperId, "vote"));
  }
  const known = new Set(job.criteria?.map((criterion) => criterion.key));
  // A criterion given as the reason to exclude is one the voter says is not met, so its answer is No wherever the vote was cast from.
  const given = { ...Object.fromEntries(Object.entries(answers ?? {}).filter(([key]) => known.has(key))), ...(decision === "exclude" && reason && known.has(reason) ? { [reason]: "no" as const } : {}) };
  const vote = { status: "cast" as const, decision, answers: given, reason: decision === "exclude" ? reason : undefined, note: note?.trim() || undefined, at: Date.now(), flagged: undefined };
  if (mine) await ctx.db.patch("screeningVotes", mine._id, vote);
  else {
    // A reviewer who votes on a paper that wasn't given to them is on it from then on.
    await ctx.db.insert("screeningVotes", { jobId, resultId: paperId, reviewerId: reviewer._id, place: paper.place ?? 0, ...vote });
    await countDealt(ctx, new Map([[reviewer._id, 1]]));
  }
  await settleLater(ctx, paperId, "vote");
}

/**
 * Casts the person's own vote on one paper of a screening they review: include, maybe or exclude, with a reason on
 * exclude (a criterion's key, `duplicate` or `other`), their answers to its criteria if they gave any, and a note.
 * `decision: null` takes their vote back.
 */
export const vote = workspaceMutation({
  args: voteArgs,
  returns: v.null(),
  handler: async (ctx, actor, args) => {
    await cast(ctx, actor, { ...args, answers: args.answers as Record<string, Answer> | undefined });
    return null;
  },
});

/** The most papers one call votes on together. */
export const VOTE_MANY = 100;

/**
 * Casts the person's own vote on several papers of a screening they review, the same vote on each, up to 100 at a
 * time.
 */
export const voteMany = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), paperIds: v.array(v.id("screeningResults")), decision: decisionValidator, reason: v.optional(v.string()), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, actor, { paperIds, ...same }) => {
    if (paperIds.length > VOTE_MANY) throw createError("VALIDATION_ERROR", `Vote on up to ${VOTE_MANY} papers at a time.`);
    for (const paperId of new Set(paperIds)) await cast(ctx, actor, { ...same, paperId });
    return null;
  },
});

/**
 * Settles one paper of a screening, for the person its rule names to settle conflicts: their decision stands
 * whatever its votes say, with a reason on exclude and a note. `decision: null` takes it back, and the paper stands
 * where its votes put it.
 */
export const resolve = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), paperId: v.id("screeningResults"), decision: v.union(decisionValidator, v.null()), reason: v.optional(v.string()), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, paperId, decision, reason, note }) => {
    const standing = await standingOn(ctx, actor, jobId);
    if (!standing || standing.job.shape !== 2) throw createError("SCREENING_JOB_NOT_FOUND", "Screening not found");
    const { job } = standing;
    if (job.rule?.resolver !== actor.userId) throw createError("FORBIDDEN", "Only whoever settles this screening's conflicts decides a paper for everyone.");
    if (job.finishedAt !== undefined) throw createError("CONFLICT", "This screening is finished. Reopen it to settle a paper.");
    await paperOf(ctx, jobId, paperId);
    requireReason(job, reason);
    if (decision === "exclude" && !reason) throw createError("VALIDATION_ERROR", "Say why the paper is excluded.");
    await ctx.db.patch("screeningResults", paperId, { resolved: decision ? { decision, by: actor.userId, at: Date.now(), ...(note?.trim() ? { note: note.trim().slice(0, SCREENING_TEXT.voteNote) } : {}), ...(decision === "exclude" && reason ? { reason } : {}) } : undefined });
    await settleLater(ctx, paperId, "vote");
    return null;
  },
});
