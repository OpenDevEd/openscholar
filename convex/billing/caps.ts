/**
 * What an organization's members spend each month, and the caps its admins set on it on Team
 * (#652), as pages and the assistant read and change them. The sums and the check every hold
 * runs are in ./memberCaps.ts.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, reversedBy, userMutation, userQuery } from "../lib/userActions";
import { TEAM_PLAN } from "../../lib/billing/plans";
import { readAccount } from "./accounts";
import { capOf, capRow, MAX_MEMBER_CAP, spentThisMonth, workspaceSpentThisMonth } from "./memberCaps";

const SET_CAP = "billing/caps:setCap" as const;

const spendingValidator = v.object({
  userId: v.id("users"),
  name: v.string(),
  imageUrl: v.optional(v.string()),
  you: v.boolean(),
  /** Credits charged for their work this month. */
  spent: v.number(),
  /** Their cap this month, on Team. */
  cap: v.optional(v.number()),
});

/** Whether the workspace is an organization the person administers; a person's own workspace has no members to list. */
async function organizationOf(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  return workspace?.kind === "organization" ? workspace.organizationId : null;
}

export const spendingAction = defineUserQuery({
  path: "billing/caps:spending",
  description:
    "Lists what members of the organization the person is in spent of its credits this month, a page at a time, each with the cap an admin set on it on the Team plan. " +
    "The person comes first. An admin sees every member; a member sees only themselves. `cursor` is `continueCursor` from the page before.",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(spendingValidator),
  run: async (ctx, { userId, workspaceId, role }, { paginationOpts }) => {
    const organizationId = await organizationOf(ctx, workspaceId);
    const row = async (memberId: Id<"users">) => {
      const user = await ctx.db.get("users", memberId);
      if (!user || user.state !== "active") return [];
      const cap = await capOf(ctx, workspaceId, memberId);
      return [{ userId: memberId, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), you: memberId === userId, spent: await spentThisMonth(ctx, workspaceId, memberId), ...(cap === undefined ? {} : { cap }) }];
    };
    const mine = paginationOpts.cursor ? [] : await row(userId);
    if (!organizationId || role !== "admin") return { page: mine, isDone: true, continueCursor: "" };
    const page = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organizationId).eq("state", "active")).paginate(paginationOpts);
    const others = await Promise.all(
      page.page.map(async ({ clerkUserId }) => {
        const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique();
        return user && user._id !== userId ? await row(user._id) : [];
      }),
    );
    return { ...page, page: [...mine, ...others.flat()] };
  },
});
export const spending = userQuery(spendingAction);
export const spendingForAssistant = assistantQuery(spendingAction);

export const allowanceAction = defineUserQuery({
  path: "billing/caps:allowance",
  description:
    "Says what the person spent of the organization's credits this month, and their cap if an admin set one on the Team plan; with no cap they draw on its credits freely. " +
    "`total` is what everyone spent this month for an admin, and the person's own for anyone else. In their own workspace it's what they spent of their own credits.",
  args: {},
  returns: v.object({ spent: v.number(), cap: v.optional(v.number()), total: v.number() }),
  run: async (ctx, { userId, workspaceId, role }) => {
    const cap = await capOf(ctx, workspaceId, userId);
    const spent = await spentThisMonth(ctx, workspaceId, userId);
    return { spent, ...(cap === undefined ? {} : { cap }), total: role === "admin" ? await workspaceSpentThisMonth(ctx, workspaceId) : spent };
  },
});
export const allowance = userQuery(allowanceAction);
export const allowanceForAssistant = assistantQuery(allowanceAction);

const capArgs = { userId: v.id("users"), cap: v.union(v.number(), v.null()) };

export const setCapAction = defineUserMutation({
  path: SET_CAP,
  description:
    `Sets how many of the organization's credits a member may spend each month, or takes the cap off with null; an admin does this, on the Team plan. Up to ${MAX_MEMBER_CAP.toLocaleString("en")} credits. ` +
    "What they spent this month counts against it at once. Returns `undo`, which puts the cap back as it was.",
  args: capArgs,
  returns: v.object({ undo: reversedBy(SET_CAP, capArgs) }),
  spendsCredits: false,
  // It changes what another person can spend.
  outsideEffect: true,
  undoable: true,
  run: async (ctx, { userId: adminId, workspaceId, role }, { userId, cap }) => {
    const organizationId = await organizationOf(ctx, workspaceId);
    if (!organizationId || role !== "admin") throw createError("FORBIDDEN", "Only an admin of the organization sets members' caps.");
    if ((await readAccount(ctx, workspaceId))?.plan !== TEAM_PLAN) throw createError("FORBIDDEN", "Caps for each member come with the Team plan.");
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > MAX_MEMBER_CAP)) {
      throw createError("VALIDATION_ERROR", `A cap is a whole number of credits from 1 to ${MAX_MEMBER_CAP.toLocaleString("en")}.`);
    }
    const user = await ctx.db.get("users", userId);
    const member = user && (await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", organizationId).eq("clerkUserId", user.clerkId).eq("state", "active")).first());
    if (!member) throw createError("NOT_FOUND", "This person isn't a member of the organization.");
    const existing = await capRow(ctx, workspaceId, userId);
    const was = existing?.cap ?? null;
    if (was === cap) return {};
    if (cap === null) await ctx.db.delete("memberCaps", existing!._id);
    else if (existing) await ctx.db.patch("memberCaps", existing._id, { cap, setBy: adminId, updatedAt: Date.now() });
    else await ctx.db.insert("memberCaps", { workspaceId, userId, cap, setBy: adminId, updatedAt: Date.now() });
    return { undo: { path: SET_CAP, args: { userId, cap: was } } };
  },
});
export const setCap = userMutation(setCapAction);
export const setCapForAssistant = assistantMutation(setCapAction);
