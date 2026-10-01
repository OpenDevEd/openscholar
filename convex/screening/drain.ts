/**
 * Screen all's answers reach the job's screening through its results. A finished paper puts
 * its answers on its own result row and marks them pending, so papers finishing together
 * never write the same document; one writer at a time (`screeningAnswersPool`) then moves
 * them into the screening, a batch per transaction. A screening counts every change to its
 * answers, so every writer to it would otherwise conflict on that count.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { answerPaper } from "../research/answers";
import { screeningAnswersPool } from "../workpool";

/** Results moved per transaction: about five index reads each, well inside 4,096. */
const DRAIN_BATCH = 100;

/**
 * Moves one result's answers into its job's screening and clears them from the result. A
 * job without a screening, from before #334, gets one with its first moved result.
 */
export async function moveResultAnswers(ctx: MutationCtx, result: Doc<"screeningResults">) {
  if (!result.answers) return false;
  const job = (await ctx.db.get("screeningJobs", result.jobId))!;
  let screeningId = job.screeningId;
  if (!screeningId) {
    screeningId = await ctx.db.insert("screenings", { userId: job.userId, version: 0, createdAt: job.createdAt });
    await ctx.db.patch("screeningJobs", job._id, { screeningId });
  }
  const questions = new Map(job.questions.map((q) => [q.key, q.question] as const));
  const entries = Object.entries(result.answers);
  const unknown = entries.find(([key]) => !questions.has(key));
  if (unknown) throw new Error(`Result ${result._id} answers question key ${unknown[0]}, which job ${job._id} doesn't have.`);
  const responses = entries.map(([key, response]) => ({
    question: questions.get(key)!,
    response,
    ...(result.confidences?.[key] === undefined ? {} : { confidence: result.confidences[key] }),
  }));
  await answerPaper(ctx, screeningId, result.openalexId, responses, "model", result.completedAt ?? result.createdAt);
  await ctx.db.patch("screeningResults", result._id, { answers: undefined, confidences: undefined, pendingAnswers: undefined });
  return true;
}

/** Queues a move of a job's pending answers; the queue runs one at a time. */
export function drainLater(ctx: MutationCtx, jobId: Doc<"screeningJobs">["_id"]) {
  return screeningAnswersPool.enqueueMutation(ctx, internal.screening.drain.drainJobAnswers, { jobId });
}

/** Moves a batch of a job's pending answers into its screening, and queues the next batch. */
export const drainJobAnswers = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.number(),
  handler: async (ctx, { jobId }) => {
    const pending = await ctx.db
      .query("screeningResults")
      .withIndex("by_job_and_pendingAnswers", (q) => q.eq("jobId", jobId).eq("pendingAnswers", true))
      .take(DRAIN_BATCH);
    for (const result of pending) await moveResultAnswers(ctx, result);
    if (pending.length === DRAIN_BATCH) await drainLater(ctx, jobId);
    return pending.length;
  },
});
