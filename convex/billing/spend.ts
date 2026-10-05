/**
 * An approved job's hold is settled when the job ends (./charge.ts `settleSpent`), whichever
 * function ends it: a job has many ways to end, and a hold left standing keeps the person's
 * credits. This module holds no Convex functions, so the triggers can load it.
 */
import { makeFunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";

const settleSpent = makeFunctionReference<"action", { chargeId: string; attempt: number }>("billing/charge:settleSpent");

/**
 * A job stops spending when it's done, failed or cancelled, and when it stops for credits:
 * under a hold that is the figure it was allowed. Carried on after that, its items pay their own way.
 */
const ENDED = new Set(["completed", "failed", "cancelled", "creditsExhausted"]);

type Job = { status?: string; spendHold?: string };

/** Settles the hold of a job that just ended or was deleted. Settling twice does nothing the second time. */
export async function settleEndedJob(ctx: MutationCtx, { oldDoc, newDoc }: { oldDoc: Job | null; newDoc: Job | null }) {
  const hold = oldDoc?.spendHold ?? newDoc?.spendHold;
  const ended = (job: Job | null) => job === null || ENDED.has(job.status ?? "");
  if (hold && ended(newDoc) && oldDoc !== null && !ended(oldDoc)) await ctx.scheduler.runAfter(0, settleSpent, { chargeId: hold, attempt: 0 });
}
