/**
 * An approved job's hold is settled when the job has ended (./charge.ts `settleSpent`),
 * whichever function ends it: a job has many ways to end, and a hold left standing keeps the
 * person's credits. This module holds no Convex functions, so the triggers can load it.
 */
import type { FunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";

/**
 * A job stops spending when it's done, failed or cancelled, and when it stops for credits:
 * under a hold that is the figure it was allowed. Carried on after that, its items pay their own way.
 */
const ENDED = new Set(["completed", "failed", "cancelled", "creditsExhausted"]);

type Job = { _id: string; status?: string; spendHold?: string };

/**
 * What a job the person carries on keeps of its approval, as a patch. Paused with its hold
 * still taking items, all of it: it goes on under the hold. With the hold settled, nothing:
 * its items hold their own, as in a job started from the page. In between, the hold still
 * has the credits those items would hold and the job's last items are being recorded under
 * it, so the job waits for that: it throws.
 */
export async function approvalLeft(ctx: MutationCtx, job: Pick<Job, "status" | "spendHold">) {
  if (job.spendHold === undefined) return {};
  const hold = job.spendHold;
  const row = await ctx.db.query("billingHolds").withIndex("by_charge", (q) => q.eq("chargeId", hold)).unique();
  if (!row) return { spendHold: undefined, spendCap: undefined };
  if (!row.settling && job.status !== "creditsExhausted") return {};
  throw createError("CONFLICT", "The credits this job was approved with are still being settled. Try again in a minute.");
}

/**
 * A trigger that hands a job's hold to `settle` when the job has just ended or was deleted:
 * the job's own function, which settles the hold once the job's items still running have
 * been recorded under it. A job that ends twice is settled once.
 */
export const settleEndedJob =
  <Id extends string>(settle: FunctionReference<"mutation", "public" | "internal", { jobId: Id; hold: string; waited: number }>) =>
  async (ctx: MutationCtx, { oldDoc, newDoc }: { oldDoc: (Job & { _id: Id }) | null; newDoc: (Job & { _id: Id }) | null }) => {
    const ended = (job: Job | null) => job === null || ENDED.has(job.status ?? "");
    if (oldDoc?.spendHold && !ended(oldDoc) && ended(newDoc)) await ctx.scheduler.runAfter(0, settle, { jobId: oldDoc._id, hold: oldDoc.spendHold, waited: 0 });
  };
