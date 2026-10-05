/**
 * An approved job's hold is settled when the job ends (./charge.ts `settleSpent`), whichever
 * function ends it: a job has many ways to end, and a hold left standing keeps the person's
 * credits. This module holds no Convex functions, so the triggers can load it.
 */
import { makeFunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";

const laterSpent = makeFunctionReference<"mutation", { chargeId: string; attempt: number; delay: number }>("billing/charge:laterSpent");

/**
 * A job stops spending when it's done, failed or cancelled, and when it stops for credits:
 * under a hold that is the figure it was allowed. Carried on after that, its items pay their own way.
 */
const ENDED = new Set(["completed", "failed", "cancelled", "creditsExhausted"]);

/**
 * How long after a job ends its hold is settled, so the items still running are recorded
 * under it: a moment for a job that ran to its end, whose last item is being recorded as it
 * ends, and as long as an item may still run for one stopped or cancelled partway.
 */
const SETTLE_AFTER_MS = { done: 30_000, stopped: 5 * 60_000 };

type Job = { status?: string; spendHold?: string };

/**
 * What a job the person carries on keeps of its approval, as a patch: nothing once it has
 * stopped for credits or its hold no longer takes items. Its items then hold their own, as
 * in a job started from the page.
 */
export async function approvalLeft(ctx: MutationCtx, job: Job) {
  if (job.spendHold === undefined) return {};
  const hold = job.spendHold;
  const row = job.status === "creditsExhausted" ? null : await ctx.db.query("billingHolds").withIndex("by_charge", (q) => q.eq("chargeId", hold)).unique();
  return row && !row.settling ? {} : { spendHold: undefined, spendCap: undefined };
}

/** Schedules the settling of the hold of a job that just ended or was deleted. A job that ends twice is settled once. */
export async function settleEndedJob(ctx: MutationCtx, { oldDoc, newDoc }: { oldDoc: Job | null; newDoc: Job | null }) {
  const hold = oldDoc?.spendHold ?? newDoc?.spendHold;
  const ended = (job: Job | null) => job === null || ENDED.has(job.status ?? "");
  if (!hold || !ended(newDoc) || oldDoc === null || ended(oldDoc)) return;
  const ran = newDoc?.status === "completed" || newDoc?.status === "failed";
  await ctx.scheduler.runAfter(0, laterSpent, { chargeId: hold, attempt: 0, delay: ran ? SETTLE_AFTER_MS.done : SETTLE_AFTER_MS.stopped });
}
