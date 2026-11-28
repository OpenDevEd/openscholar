/**
 * A place on a screening for someone it is shared with to vote: taken when they are invited by email or given it by
 * name, so a "Can vote" never leaves its guest without a queue. Each is a reviewer to come, counted against the most a
 * screening has (people and models who left it included, whose votes it keeps), and a change of who reviews: the
 * papers settled so far keep their results (./reviewers.ts `holdSettled`).
 *
 * This module holds no Convex functions, so the triggers can load it.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { MAX_REVIEWERS } from "./validators";

export async function takeVotingSeat(ctx: MutationCtx, item: string, userId?: Id<"users">) {
  const jobId = ctx.db.normalizeId("screeningJobs", item);
  const job = jobId ? await ctx.db.get("screeningJobs", jobId) : null;
  if (!job || job.shape !== 2) return;
  const reviewers = await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(MAX_REVIEWERS);
  // Someone who reviewed it before comes back to their own place.
  if (!(userId && reviewers.some((one) => one.userId === userId))) {
    const now = Date.now();
    const waiting = (await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", item).eq("state", "pending")).take(MAX_REVIEWERS)).filter((one) => one.role === "editor" && one.expiresAt > now);
    // An invitation sent is among those waiting already; a place given by name, or an invitation just answered, is one more.
    if (reviewers.length + waiting.length + (userId ? 1 : 0) > MAX_REVIEWERS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_REVIEWERS} reviewers, people and models who left it included. Invite them to look at it instead.`);
  }
  await ctx.db.patch("screeningJobs", job._id, { heldAt: Date.now() });
}
