// How many reports a workspace may start in a day (plans/publish-reports). Each workspace has its own count: a
// person's own starts at 1 a day and an organisation's at 0, and an admin gives any workspace a number of its own.
// A start counts for 24 hours whatever becomes of the report, so a limit raised today opens that many more today.
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../lib/functions";
import { requireAdmin } from "../admins/access";
import { refuseApps } from "../lib/auth";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { ensureWorkspace } from "../workspaces/create";
import { organizationWorkspaceOf } from "../workspaces/personal";
import { MAX_DAILY_LIMIT, START_COUNTS_MS, dailyLimit, limitFor, limitWords, type WorkspaceKind } from "../../lib/reports/settings";
import { reportSettings } from "./settings";

const ownLimit = (ctx: QueryCtx, workspaceId: Id<"workspaces">) => ctx.db.query("reportLimits").withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId)).unique();

/** A workspace's limit as it is now, and how many more reports it may start at `now`. */
export async function startsLeft(ctx: QueryCtx, workspaceId: Id<"workspaces">, now: number): Promise<{ kind: WorkspaceKind; perDay: number; left: number }> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) throw createError("NOT_FOUND", "Workspace not found");
  const perDay = limitFor(await reportSettings(ctx), workspace.kind, (await ownLimit(ctx, workspaceId))?.perDay);
  // Only as many as the limit are read: one more start than that changes nothing.
  const started = await ctx.db.query("reportStarts").withIndex("by_workspaceId_and_at", (q) => q.eq("workspaceId", workspaceId).gt("at", now - START_COUNTS_MS)).take(Math.min(perDay, MAX_DAILY_LIMIT));
  return { kind: workspace.kind, perDay, left: Math.max(0, perDay - started.length) };
}

/** Counts a report started in a workspace now, refusing when its day is used up. The caller has checked the person may act there. */
export async function countStart(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const now = Date.now();
  const { kind, perDay, left } = await startsLeft(ctx, workspaceId, now);
  if (left === 0) throw createError("FORBIDDEN", limitWords(perDay, kind));
  await ctx.db.insert("reportStarts", { workspaceId, at: now });
}

const accountValidator = v.union(v.object({ userId: v.id("users") }), v.object({ organizationId: v.id("organizations") }));

const limitRow = v.object({
  _id: v.id("reportLimits"),
  /** Whose workspace it is, as `set` takes it. None once the account or organisation has gone. */
  account: v.optional(accountValidator),
  kind: v.union(v.literal("personal"), v.literal("organization")),
  name: v.string(),
  /** A person's email. */
  detail: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  perDay: v.number(),
});

/** Most rows one page holds. */
const PAGE_MAX = 50;

async function shown(ctx: QueryCtx, row: Doc<"reportLimits">): Promise<Infer<typeof limitRow>> {
  const workspace = await ctx.db.get("workspaces", row.workspaceId);
  const base = { _id: row._id, perDay: row.perDay };
  if (workspace?.kind === "organization") {
    const organization = await ctx.db.get("organizations", workspace.organizationId);
    return { ...base, kind: "organization" as const, name: organization?.name ?? "", ...(organization ? { account: { organizationId: organization._id } } : {}), ...(organization?.imageUrl ? { imageUrl: organization.imageUrl } : {}) };
  }
  const person = workspace ? await ctx.db.get("users", workspace.userId) : null;
  const named = person ? personName(person) : "";
  // The email is the name of someone who gave none, and is then not said twice.
  return { ...base, kind: "personal" as const, name: named || person?.email || "", ...(person ? { account: { userId: person._id } } : {}), ...(person && named ? { detail: person.email } : {}), ...(person?.avatarUrl ? { imageUrl: person.avatarUrl } : {}) };
}

/** The workspaces with a limit of their own, the newest first, a page at a time. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(limitRow),
  handler: async (ctx, { paginationOpts }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const read = await ctx.db.query("reportLimits").order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) });
    return { ...read, page: await Promise.all(read.page.map((row) => shown(ctx, row))) };
  },
});

/**
 * Gives a person's own workspace or an organisation's a daily limit of its own, or changes the one it has. With
 * `keep`, a workspace that already has one keeps it: the picker's way in, which must never overwrite a number an
 * admin set. Answers the limit the workspace has now.
 */
export const set = mutation({
  args: { account: accountValidator, perDay: v.number(), keep: v.optional(v.boolean()) },
  returns: v.number(),
  handler: async (ctx, { account, perDay, keep }) => {
    await refuseApps(ctx);
    const admin = await requireAdmin(ctx);
    let workspaceId: Id<"workspaces">;
    if ("userId" in account) {
      const person = await ctx.db.get("users", account.userId);
      if (person?.state !== "active") throw createError("NOT_FOUND", "That account is no longer there.");
      workspaceId = await ensureWorkspace(ctx, { kind: "personal", userId: account.userId });
    } else {
      const organization = await ctx.db.get("organizations", account.organizationId);
      if (organization?.state !== "active") throw createError("NOT_FOUND", "That organisation is no longer there.");
      workspaceId = await organizationWorkspaceOf(ctx, account.organizationId);
    }
    const kept = await ownLimit(ctx, workspaceId);
    if (kept && keep) return kept.perDay;
    const fields = { perDay: dailyLimit(perDay), updatedAt: Date.now(), updatedBy: admin._id };
    if (kept) await ctx.db.patch("reportLimits", kept._id, fields);
    else await ctx.db.insert("reportLimits", { workspaceId, ...fields });
    return fields.perDay;
  },
});

/** Takes a workspace's own limit away: it goes back to the one for its kind. */
export const remove = mutation({
  args: { limitId: v.id("reportLimits") },
  returns: v.null(),
  handler: async (ctx, { limitId }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    if (await ctx.db.get("reportLimits", limitId)) await ctx.db.delete("reportLimits", limitId);
    return null;
  },
});
