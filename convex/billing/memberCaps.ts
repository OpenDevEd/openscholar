/**
 * What an organization's members spend of its credits each month, and their caps on Team (#652).
 * Autumn enforces a cap: it's the monthly usage limit on the member's entity, and every hold and
 * charge of theirs is made as that entity (`chargedAs`). Convex keeps the cap for pages to read,
 * and the spending, summed in the usage aggregate under `member:<workspace>:<user>`.
 * Pages and the assistant read and set them through ./caps.ts; charges call `chargedAs` from ./charge.ts.
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { monthStart } from "../../lib/billing/month";
import { TEAM_PLAN } from "../../lib/billing/plans";
import { readAccount } from "./accounts";
import { seatSyncRow } from "./seatSyncs";
import { memberSpace, spendSpace, usageAgg } from "./usageLog";
import { usageKindValidator } from "./validators";

/** The refusal a person sees when the cap an admin set on them stops work that takes up to `credits` (#652). */
export const capReached = (credits: number) =>
  createError("MEMBER_CAP_REACHED", `This takes up to ${credits.toLocaleString("en")} credits, more than is left of the monthly cap an admin set for you. Ask an admin to raise your cap.`);

/** The highest cap an admin sets on one member, in credits a month. */
export const MAX_MEMBER_CAP = 1_000_000;

/** A member's open holds one read sums: a job holds a paper at a time for each slot, and a workspace has 40 slots at most. */
const OPEN_HOLDS_READ = 200;

/** Credits the organization was charged for the member's work since `month`; it can be a moment behind the newest charge. */
export async function spentSince(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, month: number) {
  return await usageAgg.sum(ctx, { namespace: memberSpace(workspaceId, userId), bounds: { lower: { key: month, id: "", inclusive: true } }, stale: true });
}

/** A person's newest charges one read checks for any the ledger worker hasn't counted yet (convex/billing/ledger.ts): it counts within seconds. */
const RECENT_CHARGES_READ = 20;

/**
 * Whether the person spent the organization's credits since `since`, or holds some now: then
 * their seat stays theirs until the renewal if they leave (#863). What the ledger counted, a hold,
 * or a charge it hasn't counted yet each say so.
 */
export async function spentThisPeriod(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, since: number) {
  if ((await spentSince(ctx, workspaceId, userId, since)) > 0) return true;
  if (await ctx.db.query("billingHolds").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId)).first()) return true;
  const recent = await ctx.db.query("billingUsage").withIndex("by_user_and_createdAt", (q) => q.eq("userId", userId).gte("createdAt", since)).order("desc").take(RECENT_CHARGES_READ);
  return recent.some((charge) => charge.workspaceId === workspaceId && charge.kind !== "refund" && charge.credits > 0);
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
 * What's left of the member's cap this month, or undefined with no cap. It counts what they hold
 * as well as what they spent: a job of theirs running beside a reply holds its papers' credits.
 * A cap holds only while the member has the seat their work is charged as: once they've left,
 * what's left of their jobs is charged to the organization, with no cap on it.
 *
 * ponytail: an approved job's hold counts in full beside what's already recorded under it, so
 * while one is part way through this reads less than Autumn would allow, never more. Summing
 * each open hold's items (billingHoldItems) would make it exact, at a read per item.
 *
 * `month` is the first moment of the month in UTC: a page's read is given it, so the figure
 * moves on with the page's month, not with a clock the read would have to look at.
 */
export async function capLeft(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, month: number) {
  const cap = await capOf(ctx, workspaceId, userId);
  if (cap === undefined || !(await chargedAs(ctx, workspaceId, userId))) return undefined;
  const holds = await ctx.db.query("billingHolds").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId)).take(OPEN_HOLDS_READ);
  const held = holds.reduce((sum, hold) => sum + hold.credits, 0);
  return Math.max(0, cap - held - (await spentSince(ctx, workspaceId, userId, month)));
}

/**
 * Credits the person can spend in the workspace now, for a hold sized to them: its cached balance,
 * or what's left of their cap this month when that's less. Undefined before the account is first
 * read. Autumn enforces both. It reads the clock for the month, as a mutation or a read made once may.
 */
export async function spendable(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  const balance = (await readAccount(ctx, workspaceId))?.balance;
  const left = await capLeft(ctx, workspaceId, userId, monthStart(Date.now()));
  return left === undefined ? balance : Math.min(balance ?? left, left);
}

/**
 * What a preflight checks work against before it starts: the credits the person can spend in the
 * workspace now, and whether their cap is what holds that under its balance, so a refusal says
 * which. Autumn decides when the credits are held. It reads the clock for the month, as a
 * mutation or a read made once may: a page's own read passes its month to `capLeft`.
 */
export async function spendingRoom(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  const balance = (await readAccount(ctx, workspaceId))?.balance ?? 0;
  const left = await capLeft(ctx, workspaceId, userId, monthStart(Date.now()));
  return left !== undefined && left < balance ? { available: left, capped: true } : { available: balance, capped: false };
}

/** The refusal a member sees who joined past the seats bought, in a race, until an admin adds one (#863). */
export const noSeat = () => createError("FORBIDDEN", "The organization has no free seat for you yet. Ask an admin to add one.");

/**
 * Whether the person is a member of the organization waiting for a seat: one joined past the
 * seats bought, in a race, and spends nothing until they have one. A member the sync hasn't
 * reached yet isn't kept waiting.
 */
export async function waitsForSeat(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  if (!(await seatSyncRow(ctx, workspaceId))?.overflow) return false;
  const workspace = await ctx.db.get("workspaces", workspaceId);
  const user = await ctx.db.get("users", userId);
  if (workspace?.kind !== "organization" || !user || (await seatOf(ctx, workspaceId, user.clerkId))) return false;
  const membership = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("clerkUserId", user.clerkId).eq("state", "active")).first();
  return membership !== null;
}

/** A member's seat in the organization, by their Clerk ID: the Autumn entity their charges are made as. */
export const seatOf = (ctx: QueryCtx, workspaceId: Id<"workspaces">, clerkUserId: string) =>
  ctx.db.query("memberSeats").withIndex("by_workspace_and_member", (q) => q.eq("workspaceId", workspaceId).eq("clerkUserId", clerkUserId)).unique();

/** The entity a person's charges in the workspace are made as: their seat, when they hold one; else none, and the whole customer pays. */
export async function chargedAs(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: Id<"users"> | undefined) {
  const user = userId ? await ctx.db.get("users", userId) : null;
  return user && (await seatOf(ctx, workspaceId, user.clerkId)) ? user.clerkId : undefined;
}
