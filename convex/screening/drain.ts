/**
 * Screen all's answers reach the job's screening through its results. A finished paper puts
 * its answers on its own result row and marks them pending, so papers finishing together
 * never write the same document; the bookkeeping worker, the one writer, then moves them
 * into the screening (./bookkeeping.ts). A screening counts every change to its answers, so
 * every writer to it would otherwise conflict on that count.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { answerPaper } from "../research/answers";

/** Moves one result's answers into its job's screening and clears them from the result. */
export async function moveResultAnswers(ctx: MutationCtx, result: Doc<"screeningResults">) {
  if (!result.answers) return false;
  const job = (await ctx.db.get("screeningJobs", result.jobId))!;
  const screeningId = job.screeningId;
  const questions = new Map(job.questions.map((q) => [q.key, q.question] as const));
  const entries = Object.entries(result.answers);
  const unknown = entries.find(([key]) => !questions.has(key));
  if (unknown) throw new Error(`Result ${result._id} answers question key ${unknown[0]}, which job ${job._id} doesn't have.`);
  const responses = entries.map(([key, response]) => ({
    question: questions.get(key)!,
    response,
    ...(result.confidences?.[key] === undefined ? {} : { confidence: result.confidences[key] }),
  }));
  const answersVersion = await answerPaper(ctx, screeningId, result.openalexId, responses, "model", result.completedAt ?? result.createdAt);
  await ctx.db.patch("screeningResults", result._id, { answers: undefined, confidences: undefined, pendingAnswers: undefined, answersVersion });
  return true;
}
