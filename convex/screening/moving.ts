/**
 * Moving a screening with reviewers to another workspace (../workspaces/move.ts; plans/screening-reviewers,
 * decision 20). It moves while no model is reading: a reading holds one of its workspace's slots and is paid for by
 * that workspace, so one under way finishes where it began. Its papers, votes, criteria and activity are its own and
 * go with it by its ID. What is the workspace's stays: the collection its papers were saved to.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { countOf } from "../lib/listCounts";
import { give, holds, roomFor } from "../sharing/access";
import { grantOf, itemGuestsOf, type Shared } from "../sharing/items";
import { workspaceName } from "../workspaces/personal";
import { progressRow } from "./bookkeeping";
import { dealable, modelsFree, readingModel, reviewersOf, waitingOf } from "./dealing";

/** Why a screening can't move yet, in words for whoever asked, or null. */
export async function heldHere(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">): Promise<string | null> {
  if (job.reading) return "Its papers are still arriving. Move it once they are all in.";
  const reading = "Its models are reading. Pause them to move it now, or move it once they have read every paper.";
  // A reading that began before a pause runs to its end, and holds its slot until the worker has counted it.
  if (await ctx.db.query("screeningVotes").withIndex("by_job_and_slot", (q) => q.eq("jobId", job._id).eq("slot", true)).first()) return reading;
  if (!modelsFree(job)) return null;
  const [reviewers, progress] = await Promise.all([reviewersOf(ctx, job._id), progressRow(ctx, job._id)]);
  return reviewers.filter(readingModel).some((one) => waitingOf(one, progress?.reviewers?.[one._id]) > 0) ? reading : null;
}

/**
 * Puts a screening in `to`. Its reviewers who aren't in that workspace keep it as its guests, voting as before, where
 * its plan has room for them. Conflicts go to whoever moved it when the person who settled them has no place on it
 * there. Papers it has saved stay in the collection they went to, and the ones it includes from now on go to a
 * collection of that name in the workspace it is in.
 */
export async function carry(ctx: MutationCtx, by: Id<"users">, job: Doc<"screeningJobs">, to: Id<"workspaces">) {
  const shared: Shared<"screening"> = { kind: "screening", id: job._id, workspaceId: to, name: job.name ?? "Screening", size: job.totalPapers, createdBy: job.createdBy };
  const people = (await reviewersOf(ctx, job._id)).filter(dealable);
  const outside: Doc<"users">[] = [];
  for (const one of people) {
    const person = await ctx.db.get("users", one.userId!);
    if (person && !(await holds(ctx, shared, person)) && !(await grantOf(ctx, job._id, person._id))) outside.push(person);
  }
  const most = await roomFor(ctx, shared);
  if (most !== undefined && outside.length && (await countOf(ctx, itemGuestsOf(job._id))) + outside.length > most) {
    const there = await workspaceName(ctx, to);
    throw createError("VALIDATION_ERROR", `${outside.length === 1 ? "One of its reviewers isn't" : `${outside.length} of its reviewers aren't`} in ${there} and would be its ${outside.length === 1 ? "guest" : "guests"} there. ${there}'s plan allows ${most.toLocaleString("en")} on a screening. Take reviewers off it first.`);
  }
  const saved = job.targetCollectionId ? await ctx.db.get("collections", job.targetCollectionId) : null;
  const settles = job.rule ? await ctx.db.get("users", job.rule.resolver) : null;
  const settlesThere = settles && ((await holds(ctx, shared, settles)) || people.some((one) => one.userId === settles._id) || (await grantOf(ctx, job._id, settles._id))?.role === "editor");
  await ctx.db.patch("screeningJobs", job._id, {
    workspaceId: to,
    targetCollectionId: undefined,
    ...(saved ? { newCollection: saved.name } : {}),
    ...(job.rule && !settlesThere ? { rule: { ...job.rule, resolver: by } } : {}),
  });
  await ctx.db.patch("screenings", job.screeningId, { workspaceId: to });
  for (const person of outside) await give(ctx, shared, person, "editor", { userId: by, author: "user" });
}
