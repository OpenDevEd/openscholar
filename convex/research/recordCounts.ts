/**
 * How many saved searches and shortcuts each person has, so a list of them totals its pages
 * without reading every one. The triggers on `searches` and `queryShortcuts`
 * (`convex/lib/triggers.ts`) keep the counts with every insert and delete, whichever function
 * makes it.
 *
 * A person's first count is taken a page at a time (`countRecordPage`), since their records
 * may not fit one transaction's read. While it runs, the row's `countedTo` is the creation
 * time of the last record it reached, and the trigger counts only changes to records up to
 * there: a newer one is reached by the count itself.
 */
import type { Change } from "convex-helpers/server/triggers";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The tables whose records are counted for each person. */
export type Counted = "searches" | "queryShortcuts";

/** Records, and bytes, one step of a first count reads; a record is at most 1 MiB, so a step always moves on. */
const COUNT_PAGE = 500;
const COUNT_BYTES = 4 * 1024 * 1024;

export function countRow(ctx: Pick<QueryCtx, "db">, table: Counted, userId: Id<"users">) {
  return ctx.db.query("recordCounts").withIndex("by_user_and_table", (q) => q.eq("userId", userId).eq("table", table)).unique();
}

/** Starts a person's first count of `table`; does nothing once they have one. */
export async function startCount(ctx: Pick<MutationCtx, "db" | "scheduler">, table: Counted, userId: Id<"users">) {
  if (await countRow(ctx, table, userId)) return;
  await ctx.db.insert("recordCounts", { userId, table, count: 0, countedTo: 0 });
  await ctx.scheduler.runAfter(0, internal.research.records.countRecordsPage, { table, userId });
}

/** The trigger for a counted table. */
export const countChange = (table: Counted) => async (ctx: MutationCtx, change: Change<DataModel, "searches"> | Change<DataModel, "queryShortcuts">) => {
  if (change.operation === "update") return;
  const userId = (change.newDoc ?? change.oldDoc).userId;
  const row = await countRow(ctx, table, userId);
  // The first count reads the records as this change leaves them.
  if (!row) return await startCount(ctx, table, userId);
  if (change.operation === "insert") {
    if (row.countedTo === undefined) await ctx.db.patch("recordCounts", row._id, { count: row.count + 1 });
  } else if (row.countedTo === undefined || change.oldDoc._creationTime <= row.countedTo) {
    await ctx.db.patch("recordCounts", row._id, { count: Math.max(0, row.count - 1) });
  }
};

/**
 * One step of a person's first count: the next page of their records, then the next step
 * until none are left. `research/records:countRecordsPage` runs it; this module holds no
 * Convex functions, so the triggers can load it.
 */
export async function countRecordPage(ctx: Pick<MutationCtx, "db" | "scheduler">, table: Counted, userId: Id<"users">) {
  const row = await countRow(ctx, table, userId);
  const countedTo = row?.countedTo;
  if (!row || countedTo === undefined) return;
  const page = await ctx.db
    .query(table)
    .withIndex("by_user", (q) => q.eq("userId", userId).gt("_creationTime", countedTo))
    .paginate({ cursor: null, numItems: COUNT_PAGE, maximumBytesRead: COUNT_BYTES });
  const counted = row.count + page.page.length;
  if (page.isDone) {
    await ctx.db.patch("recordCounts", row._id, { count: counted, countedTo: undefined });
  } else {
    await ctx.db.patch("recordCounts", row._id, { count: counted, countedTo: page.page.at(-1)?._creationTime ?? countedTo });
    await ctx.scheduler.runAfter(0, internal.research.records.countRecordsPage, { table, userId });
  }
}
