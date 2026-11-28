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
import { MAX_ACCOUNTS_PER_EMAIL } from "../lib/queryBounds";
import { MAX_REVIEWERS } from "./validators";

export async function takeVotingSeat(ctx: MutationCtx, item: string, /** The address an invitation went to: someone who reviewed it before comes back to their own place. */ email?: string) {
  const jobId = ctx.db.normalizeId("screeningJobs", item);
  const job = jobId ? await ctx.db.get("screeningJobs", jobId) : null;
  if (!job || job.shape !== 2) return;
  const reviewers = await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(MAX_REVIEWERS);
  const on = new Set(reviewers.flatMap((one) => (one.userId ? [one.userId] : [])));
  const now = Date.now();
  const returning = email ? (await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).take(MAX_ACCOUNTS_PER_EMAIL)).some((one) => on.has(one._id)) : false;
  // The places to come: invitations to vote still waiting, and guests let vote whose place the reviewers' worker hasn't made yet. An invitation just
  // answered is no longer waiting, and its guest is counted once, by their grant. Read in the transaction that takes the place, so two never take the last.
  const waiting = (await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", item).eq("state", "pending")).take(MAX_REVIEWERS)).filter((one) => one.role === "editor" && one.expiresAt > now);
  const given = (await ctx.db.query("itemAccess").withIndex("by_item_and_grantedAt", (q) => q.eq("item", item)).take(MAX_REVIEWERS)).filter((one) => one.role === "editor" && !on.has(one.userId as Id<"users">));
  if (!returning && reviewers.length + waiting.length + given.length > MAX_REVIEWERS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_REVIEWERS} reviewers, people and models who left it included. Invite them to look at it instead.`);
  await ctx.db.patch("screeningJobs", job._id, { heldAt: now });
}
