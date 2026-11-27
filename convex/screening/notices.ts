/**
 * The emails a screening with reviewers sends its people (plans/screening-reviewers): new papers wait for their
 * vote, conflicts wait for them to settle, a colleague's reminder, and a colleague putting them on it. Each person turns one screening's emails off
 * for themselves. The sending itself needs Node (./noticeMail.ts).
 */
import { actorIn } from "../workspaces/actor";
import { grantOf } from "../sharing/items";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalQuery } from "../lib/functions";
import { workspaceMutation } from "../lib/userActions";
import { standingOn } from "./access";
import { progressRow } from "./bookkeeping";
import { laterChecks, nameOf, newFor, waitsOn } from "./dealing";
import { screeningPath } from "../../lib/screening/links";

export const aboutValidator = v.union(v.literal("papers"), v.literal("conflicts"), v.literal("reminder"), v.literal("joined"));

/** A person's own row for one screening's emails: whether they turned them off, and when the last one about conflicts went. */
export const noticeOf = (ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">, userId: Id<"users">) => ctx.db.query("screeningNotices").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId).eq("userId", userId)).unique();

/** New papers counted for one person's email: past it the email says so many. */
const NEW_COUNTED = 500;

/** How long after a conflict arises its email goes, so a burst of them is one email, and how long before the next. */
const CONFLICTS_AFTER_MS = 10 * 60_000;
const CONFLICTS_EVERY_MS = 24 * 3_600_000;

/** Tells whoever settles a screening's conflicts that some wait, by one email for a burst of them and at most one a day. */
export async function conflictsWait(ctx: MutationCtx, jobId: Id<"screeningJobs">, userId: Id<"users">) {
  const row = await noticeOf(ctx, jobId, userId);
  if (row?.off || (row?.conflictsAt !== undefined && Date.now() - row.conflictsAt < CONFLICTS_EVERY_MS)) return;
  if (row) await ctx.db.patch("screeningNotices", row._id, { conflictsAt: Date.now() });
  else await ctx.db.insert("screeningNotices", { jobId, userId, off: false, conflictsAt: Date.now() });
  await ctx.scheduler.runAfter(CONFLICTS_AFTER_MS, internal.screening.noticeMail.send, { jobId, userId, about: "conflicts" });
}

/** What one email says, read when it is sent: null where the person turned the screening's emails off, has it no more, or nothing waits for them. */
export const context = internalQuery({
  args: { jobId: v.id("screeningJobs"), userId: v.id("users"), about: aboutValidator, by: v.optional(v.id("users")) },
  returns: v.union(v.null(), v.object({ email: v.string(), name: v.string(), path: v.string(), count: v.number(), more: v.optional(v.boolean()), finished: v.optional(v.boolean()), living: v.optional(v.boolean()), by: v.optional(v.string()) })),
  handler: async (ctx, { jobId, userId, about, by }) => {
    const [job, user, row] = await Promise.all([ctx.db.get("screeningJobs", jobId), ctx.db.get("users", userId), noticeOf(ctx, jobId, userId)]);
    // A finished screening sends nothing, except to someone just given it to vote on: they are told it is theirs once reopened.
    const finished = job?.finishedAt !== undefined;
    if (!job || (finished && about !== "joined") || user?.state !== "active" || row?.off) return null;
    // Only to someone who can still open it: in its workspace, or a guest it is shared with.
    const inside = Boolean(await actorIn(ctx, user, job.workspaceId));
    if (!inside && !(await grantOf(ctx, job._id, userId))) return null;
    const workspace = await ctx.db.get("workspaces", job.workspaceId);
    const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
    // A member opens it in its workspace, and a guest in their own.
    // A member opens it in its workspace, and a guest in their own: membership was read just above.
    const member = Boolean(organization) && inside;
    const progress = await progressRow(ctx, jobId);
    const reviewer = await ctx.db.query("screeningReviewers").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId).eq("userId", userId)).first();
    const on = reviewer && reviewer.left === undefined ? reviewer : null;
    // New papers: the ones its last check gave this person, which still wait for their vote. A reminder: everything that waits for them.
    const brought = about === "papers" ? (await laterChecks(ctx, jobId)).find((check) => check.added > 0) : undefined;
    // What waits for them is counted as every page counts it (./dealing.ts `waitsOn`).
    const waits = await waitsOn(ctx, job, userId, on, progress);
    const count = about === "conflicts" ? waits.conflicts : about === "papers" ? (on && brought ? await newFor(ctx, on._id, brought, NEW_COUNTED) : 0) : waits.forYou;
    // Someone put on a screening is told so whether or not a paper waits for them yet.
    if (!count && !(about === "joined" && (on || finished))) return null;
    const sender = by ? await ctx.db.get("users", by) : null;
    return { email: user.email, name: job.name ?? "Screening", path: `${member && organization ? `/o/${organization.slug}` : ""}${screeningPath(jobId)}`, count, ...(about === "papers" && count >= NEW_COUNTED ? { more: true } : {}), ...(finished ? { finished: true } : {}), ...(job.living ? { living: true } : {}), ...(sender ? { by: nameOf(sender) } : {}) };
  },
});

/**
 * Turns one screening's emails to the person on or off: new papers to vote on, conflicts to settle, and reminders.
 * Nobody else's emails change.
 */
export const setEmails = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, on }) => {
    if (!(await standingOn(ctx, actor, jobId))) return null;
    const row = await noticeOf(ctx, jobId, actor.userId);
    if (row) await ctx.db.patch("screeningNotices", row._id, { off: !on });
    else if (!on) await ctx.db.insert("screeningNotices", { jobId, userId: actor.userId, off: true });
    return null;
  },
});
