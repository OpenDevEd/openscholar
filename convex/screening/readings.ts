/**
 * A model's reading of one paper in a screening with reviewers (plans/screening-reviewers): what the reading
 * needs before it asks the model, and what it leaves on its row of `screeningVotes` when it ends. The row is the
 * unit of work in the pool (./slots.ts `startWaitingVotes`); the paper it is on is then settled by the bookkeeping
 * worker (./settling.ts).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { availableCredits } from "../billing/accounts";
import { internalMutation, internalQuery } from "../lib/functions";
import { screeningPool } from "../workpool";
import { readsPdfs } from "../../lib/assistant/files";
import { effortValidator } from "../aiModelConfig/validators";
import { bookkeepLater } from "./bookkeeping";
import { modelsFree, reviewersOf, touched } from "./dealing";
import { startWaitingVotes } from "./slots";
import { criteriaValidator, voteAnswersValidator, votePassagesValidator } from "./validators";

/** Everything one reading needs, in one read. Null when its row, paper or screening is gone. */
export const context = internalQuery({
  args: { voteId: v.id("screeningVotes") },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("screeningJobs"),
      // Whether the reading should go ahead: its row still waits, and its screening's models are free to read.
      go: v.boolean(),
      workspaceId: v.id("workspaces"),
      userId: v.id("users"),
      clerkId: v.string(),
      balance: v.number(),
      criteria: criteriaValidator,
      // `file`: its own PDF, which is what the model reads where the paper has no abstract.
      paper: v.object({ title: v.string(), abstract: v.optional(v.string()), file: v.optional(v.id("_storage")), pages: v.optional(v.number()) }),
      effort: v.optional(effortValidator),
      // `available: false` when the model was hidden or retired since it was put on the screening. `files`: it takes a PDF as a file. `room`: the tokens one call to it holds.
      model: v.object({ slug: v.string(), name: v.string(), input: v.number(), output: v.number(), available: v.boolean(), files: v.boolean(), room: v.optional(v.number()) }),
    }),
  ),
  handler: async (ctx, { voteId }) => {
    const vote = await ctx.db.get("screeningVotes", voteId);
    const [job, paper, reviewer] = vote ? await Promise.all([ctx.db.get("screeningJobs", vote.jobId), ctx.db.get("screeningResults", vote.resultId), ctx.db.get("screeningReviewers", vote.reviewerId)]) : [];
    const model = reviewer?.modelId ? await ctx.db.get("models", reviewer.modelId) : null;
    // Charged to the screening's workspace, in the name of whoever started it: who added the model changes nothing.
    const user = job ? await ctx.db.get("users", job.createdBy) : null;
    if (!vote || !job || !paper || !reviewer || !model || !user) return null;
    return {
      jobId: job._id,
      go: vote.status === "waiting" && reviewer.left === undefined && modelsFree(job),
      workspaceId: job.workspaceId,
      userId: user._id,
      clerkId: user.clerkId,
      balance: await availableCredits(ctx, job.workspaceId),
      criteria: job.criteria ?? [],
      paper: { title: paper.title, ...(paper.abstract ? { abstract: paper.abstract } : {}), ...(paper.file ? { file: paper.file } : {}), ...(paper.pages === undefined ? {} : { pages: paper.pages }) },
      ...(reviewer.effort ? { effort: reviewer.effort } : {}),
      model: { slug: model.modelId, name: model.name, input: model.inputPricePerMillion, output: model.outputPricePerMillion, available: model.retiredAt === undefined && !model.hidden, files: readsPdfs(model.inputModalities), ...(model.contextLength === undefined ? {} : { room: model.contextLength }) },
    };
  },
});

/** What a reading returns to the pool: the model's answers by criterion, that it didn't read the paper for now, or that it can't read this paper at all, with why in words for whoever looks. */
export const readingValidator = v.union(
  v.object({ read: v.literal(false), why: v.union(v.literal("held"), v.literal("credits")) }),
  v.object({ read: v.literal(false), why: v.literal("unreadable"), error: v.string() }),
  v.object({ read: v.literal(true), answers: voteAnswersValidator, confidences: v.record(v.string(), v.number()), passages: v.optional(votePassagesValidator), credits: v.number() }),
);

/** How much of why a model couldn't read a paper is kept. */
const ERROR_SHOWN = 300;

/**
 * The pool's callback for a reading. It writes only its own row and stamps the paper for the bookkeeping worker,
 * which counts it, frees its slot and settles the paper. A reading that didn't go ahead, its screening held or
 * its workspace out of credits, leaves the row waiting and out of the queue until the models go on.
 */
export const done = screeningPool.defineOnComplete({
  context: v.object({}),
  handler: async (ctx, { workId, result }) => {
    // The pool's callback is typed without the app's tables.
    const vote = (await ctx.db.query("screeningVotes").withIndex("by_workId", (q) => q.eq("workId", workId)).unique()) as Doc<"screeningVotes"> | null;
    if (!vote) return;
    const job = (await ctx.db.get("screeningJobs", vote.jobId)) as Doc<"screeningJobs"> | null;
    const reading = result.kind === "success" ? (result.returnValue as typeof readingValidator.type) : null;
    if (reading?.read && vote.status === "waiting") {
      // Its decision follows its answers: the worker reads it from them as it settles the paper (lib/screening/project.ts `ballotOf`).
      await ctx.db.patch("screeningVotes", vote._id, { status: "cast", answers: reading.answers, confidences: reading.confidences, passages: reading.passages, at: Date.now(), credits: (vote.credits ?? 0) + reading.credits, workId: undefined, error: undefined });
    } else if ((result.kind === "failed" || (reading && !reading.read && reading.why === "unreadable")) && vote.status === "waiting") {
      await ctx.db.patch("screeningVotes", vote._id, { status: "failed", error: (result.kind === "failed" ? result.error : (reading as { error: string }).error).slice(0, ERROR_SHOWN), workId: undefined });
    } else {
      await ctx.db.patch("screeningVotes", vote._id, { workId: undefined });
    }
    if (job && reading && !reading.read && reading.why === "credits" && !job.outOfCredits) {
      await ctx.db.patch("screeningJobs", job._id, { outOfCredits: true, ...touched() });
      await ctx.scheduler.runAfter(0, internal.screening.readings.hold, { jobId: job._id, cursor: null });
    }
    await ctx.db.patch("screeningResults", vote.resultId, { doneAt: ctx.db.vars.commitTs });
    await bookkeepLater(ctx);
  },
});

/** Rows one step of a sweep over a screening's readings handles. */
const SWEEP = 200;

async function modelReviewers(ctx: Pick<MutationCtx, "db">, jobId: Id<"screeningJobs">) {
  return (await reviewersOf(ctx, jobId)).filter((one) => one.kind === "model");
}

/**
 * Takes a screening's readings that haven't started out of its workspace's queue, a step at a time: its models
 * were paused, it was finished, or its workspace ran out of credits. The ones already started finish, and are paid for.
 */
export const hold = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()), model: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor, model = 0 }) => {
    const reviewer = (await modelReviewers(ctx, jobId))[model];
    if (!reviewer) return null;
    const page = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("status", "waiting")).paginate({ cursor, numItems: SWEEP });
    for (const vote of page.page) if (vote.waitingWorkspace !== undefined) await ctx.db.patch("screeningVotes", vote._id, { waitingWorkspace: undefined, waitingSince: undefined });
    await ctx.scheduler.runAfter(0, internal.screening.readings.hold, page.isDone ? { jobId, cursor: null, model: model + 1 } : { jobId, cursor: page.continueCursor, model });
    return null;
  },
});

/** Puts a screening's waiting readings back in its workspace's queue, a step at a time, once its models are free to read again. */
export const release = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()), model: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor, model = 0 }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    const reviewer = (await modelReviewers(ctx, jobId))[model];
    if (!job || !reviewer || !modelsFree(job)) return null;
    const page = reviewer.left === undefined ? await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("status", "waiting")).paginate({ cursor, numItems: SWEEP }) : { page: [], isDone: true, continueCursor: "" };
    for (const vote of page.page) if (vote.waitingWorkspace === undefined && vote.workId === undefined) await ctx.db.patch("screeningVotes", vote._id, { waitingWorkspace: job.workspaceId, waitingSince: job.createdAt });
    await startWaitingVotes(ctx, job.workspaceId);
    await ctx.scheduler.runAfter(0, internal.screening.readings.release, page.isDone ? { jobId, cursor: null, model: model + 1 } : { jobId, cursor: page.continueCursor, model });
    return null;
  },
});
