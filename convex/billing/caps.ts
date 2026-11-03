/**
 * What an organization's members spend each month, and the caps its admins set on it
 * (#652), as pages and the assistant read and change them. Autumn enforces a cap, as the usage
 * limit on the member's seat; ./memberCaps.ts has the sums and the copy pages read.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { assistantAction, assistantQuery, defineChangingAction, defineUserQuery, reversedBy, userAction, userQuery } from "../lib/userActions";
import { autumn } from "./autumn";
import { capLeft, capOf, capRow, hasCaps, MAX_MEMBER_CAP, seatOf, spendable as spendableBy, spentSince, workspaceSpentSince } from "./memberCaps";
import { monthStart } from "../../lib/billing/month";

const SET_CAP = "billing/caps:setCap" as const;

/** A month as the page gives it: its first moment in UTC, so the sums move on when the page's month does. */
const monthArg = { month: v.number() };

function checkMonth(month: number) {
  if (monthStart(month) !== month) throw createError("VALIDATION_ERROR", "`month` is the first moment of a month in UTC.");
}

const spendingValidator = v.object({
  userId: v.id("users"),
  name: v.string(),
  imageUrl: v.optional(v.string()),
  you: v.boolean(),
  /** Credits charged for their work this month. */
  spent: v.number(),
  /** Their cap this month. */
  cap: v.optional(v.number()),
});

/** The organization a workspace is; a person's own workspace has no members to list. */
async function organizationOf(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  return workspace?.kind === "organization" ? workspace.organizationId : null;
}

export const spendingAction = defineUserQuery({
  path: "billing/caps:spending",
  description:
    "Lists what members of the organization the person is in spent of its credits since `month` (the first moment of a month in UTC), a page at a time, each with the cap an admin set on it. " +
    "The person comes first. An admin sees every member; a member sees only themselves. `cursor` is `continueCursor` from the page before.",
  args: { paginationOpts: paginationOptsValidator, ...monthArg },
  returns: paginationResultValidator(spendingValidator),
  run: async (ctx, { userId, workspaceId, role }, { paginationOpts, month }) => {
    checkMonth(month);
    const organizationId = await organizationOf(ctx, workspaceId);
    const row = async (memberId: Id<"users">) => {
      const user = await ctx.db.get("users", memberId);
      if (!user || user.state !== "active") return [];
      const cap = await capOf(ctx, workspaceId, memberId);
      return [{ userId: memberId, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), you: memberId === userId, spent: await spentSince(ctx, workspaceId, memberId, month), ...(cap === undefined ? {} : { cap }) }];
    };
    const mine = paginationOpts.cursor ? [] : await row(userId);
    if (!organizationId || role !== "admin") return { page: mine, isDone: true, continueCursor: "" };
    // The first page keeps a place for the person, who heads it, so no page holds more than asked for.
    const numItems = Math.max(1, paginationOpts.numItems - mine.length);
    const page = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organizationId).eq("state", "active")).paginate({ ...paginationOpts, numItems });
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
    "Says what the person spent of the organization's credits since `month` (the first moment of a month in UTC), and their cap if an admin set one, with `left`, what remains of it for that month once what their running work holds is taken off; with no cap they draw on its credits freely. " +
    "`total` is what everyone spent for an admin, and the person's own for anyone else. In their own workspace it's what they spent of their own credits.",
  args: monthArg,
  returns: v.object({ spent: v.number(), cap: v.optional(v.number()), left: v.optional(v.number()), total: v.number() }),
  run: async (ctx, { userId, workspaceId, role }, { month }) => {
    checkMonth(month);
    const cap = await capOf(ctx, workspaceId, userId);
    const spent = await spentSince(ctx, workspaceId, userId, month);
    const left = await capLeft(ctx, workspaceId, userId, month);
    return { spent, ...(cap === undefined ? {} : { cap }), ...(left === undefined ? {} : { left }), total: role === "admin" ? await workspaceSpentSince(ctx, workspaceId, month) : spent };
  },
});
export const allowance = userQuery(allowanceAction);
export const allowanceForAssistant = assistantQuery(allowanceAction);

/** Credits the person can spend in the workspace now (./memberCaps.ts `spendable`), for a reply's hold; null before the account is first read. */
export const spendable = internalQuery({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { workspaceId, userId }) => (await spendableBy(ctx, workspaceId, userId)) ?? null,
});

/** Who a cap goes on, checked before Autumn is asked: the member's seat and the cap they have now. */
export const capTarget = internalQuery({
  args: { workspaceId: v.id("workspaces"), role: v.union(v.literal("admin"), v.literal("member")), memberId: v.id("users") },
  returns: v.object({ customerId: v.string(), entityId: v.string(), was: v.union(v.number(), v.null()) }),
  handler: async (ctx, { workspaceId, role, memberId }) => {
    if (!(await organizationOf(ctx, workspaceId)) || role !== "admin") throw createError("FORBIDDEN", "Only an admin of the organization sets members' caps.");
    if (!(await hasCaps(ctx, workspaceId))) throw createError("FORBIDDEN", "Caps for each member come with the Team plan.");
    const member = await ctx.db.get("users", memberId);
    // A member holds a seat once the organization's seats have caught up with them.
    if (!member || !(await seatOf(ctx, workspaceId, member.clerkId))) throw createError("NOT_FOUND", "This person isn't a member with a seat yet. If they just joined, try again in a minute.");
    return { customerId: workspaceId, entityId: member.clerkId, was: (await capRow(ctx, workspaceId, memberId))?.cap ?? null };
  },
});

/** Keeps the cap Autumn now holds the member to, for pages to show. */
export const keepCap = internalMutation({
  args: { workspaceId: v.id("workspaces"), memberId: v.id("users"), setBy: v.id("users"), cap: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, memberId, setBy, cap }) => {
    const existing = await capRow(ctx, workspaceId, memberId);
    if (cap === null) {
      if (existing) await ctx.db.delete("memberCaps", existing._id);
    } else if (existing) await ctx.db.patch("memberCaps", existing._id, { cap, setBy, updatedAt: Date.now() });
    else await ctx.db.insert("memberCaps", { workspaceId, userId: memberId, cap, setBy, updatedAt: Date.now() });
    return null;
  },
});

const capArgs = { memberId: v.id("users"), cap: v.union(v.number(), v.null()) };
// `expect`, which an undo passes, is the cap the member should have now: one changed since refuses the undo.
const undoCapArgs = { ...capArgs, expect: v.optional(v.union(v.number(), v.null())) };

export const setCapAction = defineChangingAction({
  path: SET_CAP,
  description:
    `Sets how many of the organization's credits a member may spend each calendar month (UTC), or takes the cap off with null; an admin does this. Up to ${MAX_MEMBER_CAP.toLocaleString("en")} credits. ` +
    "What they spent this month counts against it at once: past it, their replies and jobs are refused until next month or a higher cap. Returns `undo`, which puts the cap back as it was.",
  args: undoCapArgs,
  returns: v.object({ undo: reversedBy(SET_CAP, undoCapArgs) }),
  spendsCredits: false,
  // It changes what another person can spend.
  outsideEffect: true,
  undoable: true,
  run: async (ctx, { userId, workspaceId, role }, { memberId, cap, expect }) => {
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > MAX_MEMBER_CAP)) {
      throw createError("VALIDATION_ERROR", `A cap is a whole number of credits from 1 to ${MAX_MEMBER_CAP.toLocaleString("en")}.`);
    }
    const target: { customerId: string; entityId: string; was: number | null } = await ctx.runQuery(internal.billing.caps.capTarget, { workspaceId, role, memberId });
    if (expect !== undefined && target.was !== expect) throw createError("CONFLICT", "This member's cap changed since: it's left as it is now.");
    if (target.was === cap) return {};
    await autumn.setCap(target.customerId, target.entityId, cap);
    await ctx.runMutation(internal.billing.caps.keepCap, { workspaceId, memberId, setBy: userId, cap });
    return { undo: { path: SET_CAP, args: { memberId, cap: target.was, expect: cap } } };
  },
});
export const setCap = userAction(setCapAction);
export const setCapForAssistant = assistantAction(setCapAction);
