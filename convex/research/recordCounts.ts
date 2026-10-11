/**
 * How many saved searches, shortcuts and screening and extraction jobs each workspace has (#650),
 * so a list of them totals its pages without reading every one. The triggers on those tables
 * (`convex/lib/triggers.ts`) keep the counts with every insert and delete, whichever function
 * makes it.
 *
 * A workspace's first count is taken a page at a time (`countRecordPage`), since their records
 * may not fit one transaction's read. While it runs, the row's `countedTo` is the creation
 * time of the last record it reached, and the trigger counts only changes to records up to
 * there: a newer one is reached by the count itself.
 */
import type { Change } from "convex-helpers/server/triggers";
import { v } from "convex/values";
import { internal } from "../_generated/api";

import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The tables whose records are counted for each workspace. */
export type Counted = "searches" | "queryShortcuts" | "screeningJobs" | "extractionJobs";

/** Records, and bytes, one step of a first count reads; a record is at most 1 MiB, so a step always moves on. */
const COUNT_PAGE = 500;
const COUNT_BYTES = 4 * 1024 * 1024;

export function countRow(ctx: Pick<QueryCtx, "db">, table: Counted, workspaceId: Id<"workspaces">) {
  return ctx.db.query("recordCounts").withIndex("by_workspace_and_table_and_createdBy", (q) => q.eq("workspaceId", workspaceId).eq("table", table).eq("createdBy", undefined)).unique();
}

/** Starts the first count of `table` in the workspace `record` is in; does nothing once it has one. */
export async function startCount(ctx: Pick<MutationCtx, "db" | "scheduler">, table: Counted, record: { workspaceId: Id<"workspaces"> }) {
  const workspaceId = record.workspaceId;
  if (await countRow(ctx, table, workspaceId)) return;
  await ctx.db.insert("recordCounts", { workspaceId, table, count: 0, countedTo: 0 });
  await ctx.scheduler.runAfter(0, internal.research.records.countRecordsPage, { table, workspaceId });
}

/** The trigger for a counted table. */
export const countChange = (table: Counted) => async (ctx: MutationCtx, change: Change<DataModel, Counted>): Promise<void> => {
  // A record moved to another workspace (#654) leaves one count and joins the other.
  if (change.operation === "update") {
    if (change.oldDoc.workspaceId === change.newDoc.workspaceId) return;
    await countChange(table)(ctx, { ...change, operation: "delete", newDoc: null } as Change<DataModel, Counted>);
    return await countChange(table)(ctx, { ...change, operation: "insert", oldDoc: null } as Change<DataModel, Counted>);
  }
  const record = change.newDoc ?? change.oldDoc;
  const row = await countRow(ctx, table, record.workspaceId);
  // The first count reads the records as this change leaves them.
  if (!row) return await startCount(ctx, table, record);
  // While a first count runs, it reaches a new record itself, but not one moved in from another workspace behind where it has read to.
  if (change.operation === "insert") {
    if (row.countedTo === undefined || record._creationTime <= row.countedTo) await ctx.db.patch("recordCounts", row._id, { count: row.count + 1 });
  } else if (row.countedTo === undefined || change.oldDoc._creationTime <= row.countedTo) {
    await ctx.db.patch("recordCounts", row._id, { count: Math.max(0, row.count - 1) });
  }
};

/**
 * One step of a workspace's first count: the next page of its records, then the next step
 * until none are left. `research/records:countRecordsPage` runs it; this module holds no
 * Convex functions, so the triggers can load it.
 */
export async function countRecordPage(ctx: Pick<MutationCtx, "db" | "scheduler">, table: Counted, workspaceId: Id<"workspaces">) {
  const row = await countRow(ctx, table, workspaceId);
  const countedTo = row?.countedTo;
  if (!row || countedTo === undefined) return;
  const page = await ctx.db
    .query(table)
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId).gt("_creationTime", countedTo))
    .paginate({ cursor: null, numItems: COUNT_PAGE, maximumBytesRead: COUNT_BYTES });
  const counted = row.count + page.page.length;
  if (page.isDone) {
    await ctx.db.patch("recordCounts", row._id, { count: counted, countedTo: undefined });
  } else {
    await ctx.db.patch("recordCounts", row._id, { count: counted, countedTo: page.page.at(-1)?._creationTime ?? countedTo });
    await ctx.scheduler.runAfter(0, internal.research.records.countRecordsPage, { table, workspaceId });
  }
}

/** The tables whose records an organization also counts for each person who made them, for its lists' Run by (#656). */
export const byMakerValidator = v.union(v.literal("searches"), v.literal("queryShortcuts"), v.literal("screeningJobs"), v.literal("extractionJobs"), v.literal("collections"), v.literal("assistantThreads"));
export type ByMaker = "searches" | "queryShortcuts" | "screeningJobs" | "extractionJobs" | "collections" | "assistantThreads";
type Made = { workspaceId: Id<"workspaces">; createdBy: Id<"users"> };

/** How many of a table one person made in a workspace. */
export function makerCountRow(ctx: Pick<QueryCtx, "db">, table: ByMaker, workspaceId: Id<"workspaces">, createdBy: Id<"users">) {
  return ctx.db.query("recordCounts").withIndex("by_workspace_and_table_and_createdBy", (q) => q.eq("workspaceId", workspaceId).eq("table", table).eq("createdBy", createdBy)).unique();
}

/** Starts the first count of what `record`'s maker made of `table` in its workspace, in an organization; does nothing once it has one. */
export async function startMakerCount(ctx: Pick<MutationCtx, "db" | "scheduler">, table: ByMaker, { workspaceId, createdBy }: Made) {
  if ((await ctx.db.get("workspaces", workspaceId))?.kind !== "organization") return;
  if (await makerCountRow(ctx, table, workspaceId, createdBy)) return;
  await ctx.db.insert("recordCounts", { workspaceId, table, createdBy, count: 0, countedTo: 0 });
  await ctx.scheduler.runAfter(0, internal.research.records.countMakerRecordsPage, { table, workspaceId, createdBy });
}

/** The trigger that keeps each maker's count of a table, in an organization; a person's own workspace is all theirs. */
export const countMakerChange = (table: ByMaker) => async (ctx: MutationCtx, change: Change<DataModel, ByMaker>): Promise<void> => {
  // As `countChange`: a record moved to another workspace counts for its maker there instead.
  if (change.operation === "update") {
    if (change.oldDoc.workspaceId === change.newDoc.workspaceId) return;
    await countMakerChange(table)(ctx, { ...change, operation: "delete", newDoc: null } as Change<DataModel, ByMaker>);
    return await countMakerChange(table)(ctx, { ...change, operation: "insert", oldDoc: null } as Change<DataModel, ByMaker>);
  }
  const record = (change.newDoc ?? change.oldDoc) as Made & { _creationTime: number };
  const row = await makerCountRow(ctx, table, record.workspaceId, record.createdBy);
  // The first count reads the records as this change leaves them. A delete with none starts none: a
  // workspace being emptied would only count again what it's deleting.
  if (!row) return change.operation === "insert" ? await startMakerCount(ctx, table, record) : undefined;
  if (change.operation === "insert") {
    if (row.countedTo === undefined || record._creationTime <= row.countedTo) await ctx.db.patch("recordCounts", row._id, { count: row.count + 1 });
  } else if (row.countedTo === undefined || record._creationTime <= row.countedTo) {
    await ctx.db.patch("recordCounts", row._id, { count: Math.max(0, row.count - 1) });
  }
};

/** One step of a maker's first count, as `countRecordPage` takes a workspace's. */
export async function countMakerPage(ctx: Pick<MutationCtx, "db" | "scheduler">, table: ByMaker, workspaceId: Id<"workspaces">, createdBy: Id<"users">) {
  const row = await makerCountRow(ctx, table, workspaceId, createdBy);
  const countedTo = row?.countedTo;
  if (!row || countedTo === undefined) return;
  const page = await ctx.db
    .query(table)
    .withIndex("by_workspace_and_createdBy", (q) => q.eq("workspaceId", workspaceId).eq("createdBy", createdBy).gt("_creationTime", countedTo))
    .paginate({ cursor: null, numItems: COUNT_PAGE, maximumBytesRead: COUNT_BYTES });
  const counted = row.count + page.page.length;
  if (page.isDone) {
    await ctx.db.patch("recordCounts", row._id, { count: counted, countedTo: undefined });
  } else {
    await ctx.db.patch("recordCounts", row._id, { count: counted, countedTo: page.page.at(-1)?._creationTime ?? countedTo });
    await ctx.scheduler.runAfter(0, internal.research.records.countMakerRecordsPage, { table, workspaceId, createdBy });
  }
}
