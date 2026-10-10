/**
 * What an organization's member spent of its credits this month, the cap an admin set on it on
 * Team, and the check every hold runs against it (#652). Pages and the assistant read these
 * through ./caps.ts; charges call the check from ./charge.ts.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { TEAM_PLAN } from "../../lib/billing/plans";
import { readAccount } from "./accounts";
import { memberSpace, spendSpace, usageAgg } from "./usageLog";
import { usageKindValidator } from "./validators";

/** The highest cap an admin sets on one member, in credits a month. */
export const MAX_MEMBER_CAP = 1_000_000;

/** A member's open holds read at once: replies and jobs running together, which the plan's limits keep few. */
const OPEN_HOLDS_READ = 100;

/** The first moment of `now`'s month, in UTC. */
export const monthStart = (now: number) => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};

/** Credits the organization was charged for the member's work this month; it can be a moment behind the newest charge. */
export async function spentThisMonth(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, now = Date.now()) {
  return await usageAgg.sum(ctx, { namespace: memberSpace(workspaceId, userId), bounds: { lower: { key: monthStart(now), id: "", inclusive: true } }, stale: true });
}

/** Credits the workspace was charged this month, for everyone's work. Refunds aren't counted, as on the spending chart. */
export async function workspaceSpentThisMonth(ctx: QueryCtx, workspaceId: Id<"workspaces">, now = Date.now()) {
  const kinds = usageKindValidator.members.map((member) => member.value).filter((kind) => kind !== "refund");
  const lower = { key: monthStart(now), id: "", inclusive: true };
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
 * Refuses a hold of `credits` that would take the member past their cap this month. An open
 * job's hold counts in full: ponytail: what it has recorded under it so far counts twice until it
 * settles, so a member near their cap is refused a little early, never let past it. Per-hold
 * running sums if that bites.
 */
export async function checkMemberCap(ctx: MutationCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, credits: number) {
  const cap = await capOf(ctx, workspaceId, userId);
  if (cap === undefined) return;
  const holds = await ctx.db.query("billingHolds").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId)).take(OPEN_HOLDS_READ + 1);
  if (holds.length > OPEN_HOLDS_READ) throw createError("MEMBER_CAP_REACHED", "You have too much running at once to start more. Wait for some of it to finish.");
  const taken = (await spentThisMonth(ctx, workspaceId, userId)) + holds.reduce((sum, hold) => sum + hold.credits, 0);
  if (taken + credits > cap) {
    const left = Math.max(0, cap - taken);
    throw createError("MEMBER_CAP_REACHED", `This takes up to ${credits.toLocaleString("en")} credits, and ${left.toLocaleString("en")} are left of the ${cap.toLocaleString("en")} a month an admin set for you. Ask an admin to raise your cap.`);
  }
}
