/**
 * How many saved searches each person has, so a list of them totals its pages without
 * reading every search. The trigger on `searches` (`convex/lib/triggers.ts`) keeps the count
 * with every insert and delete, whichever function makes it. This module holds no Convex
 * functions, so the trigger can load it.
 */
import type { Change } from "convex-helpers/server/triggers";
import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Searches a missing count is counted from at most, in one read. ponytail: a person past
 * this many, or whose searches together pass a transaction's 16 MiB read (about 600 of the
 * longest OQL queries), fails by name here and needs a count taken a page at a time. The
 * most anyone has on shared dev is 23, and once counted, a person is never counted again.
 */
const RECOUNT_MAX = 5_000;

export function searchCountRow(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return ctx.db.query("searchCounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
}

/** A person's searches, counted: what a missing count row starts from. */
export async function countSearchesOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  const rows = await ctx.db.query("searches").withIndex("by_user", (q) => q.eq("userId", userId)).take(RECOUNT_MAX + 1);
  if (rows.length > RECOUNT_MAX) throw new Error(`User ${userId} has more than ${RECOUNT_MAX} searches; run migrations/pagedSearches.`);
  return rows.length;
}

export async function countSearchChange(ctx: MutationCtx, change: Change<DataModel, "searches">) {
  if (change.operation === "update") return;
  const userId = (change.newDoc ?? change.oldDoc).userId;
  const row = await searchCountRow(ctx, userId);
  // The search this change made or removed is already counted, or uncounted, when it's read.
  if (!row) await ctx.db.insert("searchCounts", { userId, count: await countSearchesOf(ctx, userId) });
  else await ctx.db.patch("searchCounts", row._id, { count: Math.max(0, row.count + (change.operation === "insert" ? 1 : -1)) });
}
