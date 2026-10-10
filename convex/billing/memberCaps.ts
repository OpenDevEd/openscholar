/**
 * What an organization's members spend of its credits each month, and their caps on Team (#652).
 * Autumn enforces a cap: it's the monthly usage limit on the member's entity, and every hold and
 * charge of theirs is made as that entity (`chargedAs`). Convex keeps the cap for pages to read,
 * and the spending, summed in the usage aggregate under `member:<workspace>:<user>`.
 * Pages and the assistant read and set them through ./caps.ts; charges call `chargedAs` from ./charge.ts.
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { monthStart } from "../../lib/billing/month";
import { TEAM_PLAN } from "../../lib/billing/plans";
import { readAccount } from "./accounts";
import { memberSpace, spendSpace, usageAgg } from "./usageLog";
import { usageKindValidator } from "./validators";

/** The highest cap an admin sets on one member, in credits a month. */
export const MAX_MEMBER_CAP = 1_000_000;

/** Credits the organization was charged for the member's work since `month`; it can be a moment behind the newest charge. */
export async function spentSince(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, month: number) {
  return await usageAgg.sum(ctx, { namespace: memberSpace(workspaceId, userId), bounds: { lower: { key: month, id: "", inclusive: true } }, stale: true });
}

/** Credits the workspace was charged since `month`, for everyone's work. Refunds aren't counted, as on the spending chart. */
export async function workspaceSpentSince(ctx: QueryCtx, workspaceId: Id<"workspaces">, month: number) {
  const kinds = usageKindValidator.members.map((member) => member.value).filter((kind) => kind !== "refund");
  const lower = { key: month, id: "", inclusive: true };
  const sums = await usageAgg.sumBatch(ctx, kinds.map((kind) => ({ namespace: spendSpace(workspaceId, kind), bounds: { lower } })), { stale: true });
  return sums.reduce((sum, credits) => sum + credits, 0);
}

export const capRow = (ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">) =>
  ctx.db.query("memberCaps").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId)).unique();

/** The member's cap, while the organization is on Team: caps are a Team plan's. */
export async function capOf(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  const row = await capRow(ctx, workspaceId, userId);
  if (!row || (await readAccount(ctx, workspaceId))?.plan !== TEAM_PLAN) return undefined;
  return row.cap;
}

/**
 * Credits the person can spend in the workspace now, for a hold sized to them: its cached balance,
 * or what's left of their cap this month when that's less. Undefined before the account is first
 * read. Autumn enforces both.
 */
export async function spendable(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  const balance = (await readAccount(ctx, workspaceId))?.balance;
  const cap = await capOf(ctx, workspaceId, userId);
  if (cap === undefined) return balance;
  const left = Math.max(0, cap - (await spentSince(ctx, workspaceId, userId, monthStart(Date.now()))));
  return Math.min(balance ?? left, left);
}

/** A member's seat in the organization, by their Clerk ID: the Autumn entity their charges are made as. */
export const seatOf = (ctx: QueryCtx, workspaceId: Id<"workspaces">, clerkUserId: string) =>
  ctx.db.query("memberSeats").withIndex("by_workspace_and_member", (q) => q.eq("workspaceId", workspaceId).eq("clerkUserId", clerkUserId)).unique();

/** The entity a person's charges in the workspace are made as: their seat, when they hold one; else none, and the whole customer pays. */
export async function chargedAs(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users"> | undefined) {
  const user = userId ? await ctx.db.get("users", userId) : null;
  return user && (await seatOf(ctx, workspaceId, user.clerkId)) ? user.clerkId : undefined;
}
