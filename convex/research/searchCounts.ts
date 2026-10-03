/**
 * How many saved searches each person has, so a list of them totals its pages without
 * reading every search. The trigger on `searches` (`convex/lib/triggers.ts`) keeps the count
 * with every insert and delete, whichever function makes it.
 *
 * A person's first count is taken a page at a time (`countSearchPage`), since their searches may not
 * fit one transaction's read. While it runs, the row's `countedTo` is the creation time of
 * the last search it reached, and the trigger counts only changes to searches up to there:
 * a newer one is reached by the count itself.
 */
import type { Change } from "convex-helpers/server/triggers";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Searches, and bytes, one step of a first count reads; a search is at most 1 MiB, so a step always moves on. */
const COUNT_PAGE = 500;
const COUNT_BYTES = 4 * 1024 * 1024;

export function searchCountRow(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return ctx.db.query("searchCounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
}

/** Starts a person's first count; does nothing once they have one. */
export async function startSearchCount(ctx: Pick<MutationCtx, "db" | "scheduler">, userId: Id<"users">) {
  if (await searchCountRow(ctx, userId)) return;
  await ctx.db.insert("searchCounts", { userId, count: 0, countedTo: 0 });
  await ctx.scheduler.runAfter(0, internal.research.records.countSearchesPage, { userId });
}

export async function countSearchChange(ctx: MutationCtx, change: Change<DataModel, "searches">) {
  if (change.operation === "update") return;
  const row = await searchCountRow(ctx, (change.newDoc ?? change.oldDoc).userId);
  // The first count reads the searches as this change leaves them.
  if (!row) return await startSearchCount(ctx, (change.newDoc ?? change.oldDoc).userId);
  if (change.operation === "insert") {
    if (row.countedTo === undefined) await ctx.db.patch("searchCounts", row._id, { count: row.count + 1 });
  } else if (row.countedTo === undefined || change.oldDoc._creationTime <= row.countedTo) {
    await ctx.db.patch("searchCounts", row._id, { count: Math.max(0, row.count - 1) });
  }
}

/**
 * One step of a person's first count: the next page of their searches, then the next step
 * until none are left. `research/records:countSearchesPage` runs it; this module holds no
 * Convex functions, so the triggers can load it.
 */
export async function countSearchPage(ctx: Pick<MutationCtx, "db" | "scheduler">, userId: Id<"users">) {
  const row = await searchCountRow(ctx, userId);
  const countedTo = row?.countedTo;
  if (!row || countedTo === undefined) return;
  const page = await ctx.db
    .query("searches")
    .withIndex("by_user", (q) => q.eq("userId", userId).gt("_creationTime", countedTo))
    .paginate({ cursor: null, numItems: COUNT_PAGE, maximumBytesRead: COUNT_BYTES });
  const counted = row.count + page.page.length;
  if (page.isDone) {
    await ctx.db.patch("searchCounts", row._id, { count: counted, countedTo: undefined });
  } else {
    await ctx.db.patch("searchCounts", row._id, { count: counted, countedTo: page.page.at(-1)?._creationTime ?? countedTo });
    await ctx.scheduler.runAfter(0, internal.research.records.countSearchesPage, { userId });
  }
}
