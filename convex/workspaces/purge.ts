import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { purgeWorkspaceChats } from "../assistant/access";
import { readAccount } from "../billing/accounts";
import { collectionCountRow } from "../library/collections";
import { libraryCountRow } from "../library/counter";
import { internalMutation } from "../lib/functions";
import { countRow } from "../research/recordCounts";

/** How many rows one step deletes at most. */
const STEP = 100;
/** Rows one read of rows with nothing under them takes; a row with rows under it is read alone, so its own always fit after it. */
const CHUNK = 4;
/** The most reading and deleting one row can count: a document's 1 MiB, twice, since Convex counts a deleted row as read again. */
const ROW_BYTES = 2 * 1024 * 1024;
/**
 * What one step reads at most, under the 16 MiB a Convex transaction may: a read that could take
 * it past this waits for the next step. A step's first row, and the deepest rows under it (a
 * search's screening's answers), always fit, so every step gets somewhere.
 */
const READ_BYTES = 14 * 1024 * 1024;

/** What reading a row and deleting it count against the step's reads, near enough. */
const sizeOf = (row: object) => 2 * JSON.stringify(row).length;

/**
 * Deletes a step's worth of what's in a purged workspace (#650, #651): its screening jobs,
 * searches with their revisions, history and answers, bookmarks, collections with their
 * ratings, saved papers with their places, its screening slots and its people's assistant
 * spending there. An author profile stays in the directory, owned by nobody, as one whose owner
 * was purged before workspaces is. Chats, extraction jobs and counts have their own purges.
 * A step reads a few rows at a time and stops at `STEP` rows or `READ_BYTES` read, whichever
 * comes first. Returns whether the workspace is empty of them.
 * ponytail: one step per cleanup run for a purged person, so a large library takes a run a minute; schedule steps back to back if that's too slow.
 */
export async function purgeWorkspace(ctx: MutationCtx, workspaceId: Id<"workspaces">): Promise<boolean> {
  const step: Step = { left: STEP, read: 0 };

  if (!(await each(step, (n) => ctx.db.query("screeningJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(n), async (job) => {
    if (!(await drain(ctx, step, (n) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(n), "screeningResults"))) return false;
    if (!(await drain(ctx, step, (n) => ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(n), "screeningJobProgress"))) return false;
    // A job's own screening, of no search, goes with it; a search's goes with the search.
    const screening = await ctx.db.get("screenings", job.screeningId);
    if (screening && !screening.searchId && !(await purgeScreening(ctx, step, screening._id))) return false;
    return await gone(ctx, step, job._id, "screeningJobs");
  }))) return false;

  if (!(await each(step, (n) => ctx.db.query("searches").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(n), async (search) => {
    if (!(await drain(ctx, step, (n) => ctx.db.query("searchRevisions").withIndex("by_search_and_revision", (q) => q.eq("searchId", search._id)).take(n), "searchRevisions"))) return false;
    if (!(await drain(ctx, step, (n) => ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_position", (q) => q.eq("searchId", search._id)).take(n), "searchHistory"))) return false;
    if (!(await each(step, (n) => ctx.db.query("screenings").withIndex("by_search", (q) => q.eq("searchId", search._id)).take(n), (screening) => purgeScreening(ctx, step, screening._id)))) return false;
    return await gone(ctx, step, search._id, "searches");
  }))) return false;

  if (!(await drain(ctx, step, (n) => ctx.db.query("queryShortcuts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(n), "queryShortcuts"))) return false;

  if (!(await each(step, (n) => ctx.db.query("collections").withIndex("by_workspace_sortName", (q) => q.eq("workspaceId", workspaceId)).take(n), async (collection) => {
    if (!(await drain(ctx, step, (n) => ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collection._id)).take(n), "libraryItemCollections"))) return false;
    if (!(await drain(ctx, step, (n) => ctx.db.query("evidenceLibraryCollectionSources").withIndex("by_collectionId", (q) => q.eq("collectionId", collection._id)).take(n), "evidenceLibraryCollectionSources"))) return false;
    if (!(await drain(ctx, step, (n) => ctx.db.query("ratings").withIndex("by_collection_and_paper", (q) => q.eq("collectionId", collection._id)).take(n), "ratings"))) return false;
    return await gone(ctx, step, collection._id, "collections");
  }))) return false;

  if (!(await each(step, (n) => ctx.db.query("libraryItems").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(n), async (item) => {
    if (!(await drain(ctx, step, (n) => ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", item._id)).take(n), "libraryItemCollections"))) return false;
    if (!(await drain(ctx, step, (n) => ctx.db.query("paperMetadataChanges").withIndex("by_record", (q) => q.eq("table", "libraryItems").eq("recordId", item._id)).take(n), "paperMetadataChanges"))) return false;
    return await gone(ctx, step, item._id, "libraryItems");
  }))) return false;

  if (!(await drain(ctx, step, (n) => ctx.db.query("screeningSlots").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(n), "screeningSlots"))) return false;
  if (!(await drain(ctx, step, (n) => ctx.db.query("assistantSpenders").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId)).take(n), "assistantSpenders"))) return false;

  return await each(step, (n) => ctx.db.query("authorProfiles").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(n), async (profile) => {
    if (step.left === 0) return false;
    await ctx.db.patch("authorProfiles", profile._id, { workspaceId: undefined, createdBy: undefined });
    step.left--;
    return true;
  });
}

/** What's left of a step: rows it may still delete, and the bytes it has read. */
type Step = { left: number; read: number };

/**
 * Reads rows `chunk` at a time and passes each to `purge`, until the query has none left (true)
 * or the step is used up or `purge` stops (false). Purged rows no longer match the query, so
 * each read starts from what's left.
 */
async function each<Row extends object>(step: Step, read: (n: number) => Promise<Row[]>, purge: (row: Row) => Promise<boolean>, chunk = 1) {
  for (;;) {
    if (step.left === 0 || step.read + chunk * ROW_BYTES > READ_BYTES) return false;
    const asked = Math.min(step.left, chunk);
    const rows = await read(asked);
    step.read += rows.reduce((total, row) => total + sizeOf(row), 0);
    for (const row of rows) if (!(await purge(row))) return false;
    if (rows.length < asked) return true;
  }
}

/** Deletes a row if the step has room for it; whether it went. */
async function gone(ctx: MutationCtx, step: Step, id: Id<any>, table: string) {
  if (step.left === 0) return false;
  await ctx.db.delete(table as never, id as never);
  step.left--;
  return true;
}

/** Deletes every row a query reads; whether none is left. */
const drain = (ctx: MutationCtx, step: Step, read: (n: number) => Promise<{ _id: Id<any> }[]>, table: string) => each(step, read, (row) => gone(ctx, step, row._id, table), CHUNK);

/** A screening's answers and their history, then the screening. */
async function purgeScreening(ctx: MutationCtx, step: Step, screeningId: Id<"screenings">) {
  if (!(await drain(ctx, step, (n) => ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId)).take(n), "screeningAnswers"))) return false;
  if (!(await drain(ctx, step, (n) => ctx.db.query("screeningAnswerHistory").withIndex("by_screening_and_version", (q) => q.eq("screeningId", screeningId)).take(n), "screeningAnswerHistory"))) return false;
  return await gone(ctx, step, screeningId, "screenings");
}

/**
 * Deletes an emptied workspace with what it cached: its account snapshot (its billingUsage rows
 * stay as financial records), its library, collection and record counts, then the workspace.
 */
export async function dropWorkspace(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const account = await readAccount(ctx, workspaceId);
  if (account) await ctx.db.delete("billingAccounts", account._id);
  const libraryCount = await libraryCountRow(ctx, workspaceId);
  if (libraryCount) await ctx.db.delete("libraryCounts", libraryCount._id);
  const collectionCount = await collectionCountRow(ctx, workspaceId);
  if (collectionCount) await ctx.db.delete("collectionCounts", collectionCount._id);
  for (const table of ["searches", "queryShortcuts", "screeningJobs", "extractionJobs"] as const) {
    const counted = await countRow(ctx, table, workspaceId);
    if (counted) await ctx.db.delete("recordCounts", counted._id);
  }
  await ctx.db.delete("workspaces", workspaceId);
}

/** Extraction jobs one step schedules the deletion of. */
const JOBS_A_STEP = 50;
/** How long a step waits for the extraction jobs it scheduled the deletion of. */
const JOBS_WAIT_MS = 60_000;

/**
 * Empties a deleted organization's workspace a step at a time (#651), then deletes it: its
 * extraction jobs, chats, and everything else in it. What its members made goes with it; their
 * own ratings of papers are theirs. Each step schedules the next until nothing is left.
 */
export const purgeOrganization = internalMutation({
  args: { organizationId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, { organizationId }): Promise<null> => {
    const organization = await ctx.db.get("organizations", organizationId);
    const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
    if (organization?.state !== "deleted" || !workspace) return null;
    const next = (ms: number) => ctx.scheduler.runAfter(ms, internal.workspaces.purge.purgeOrganization, { organizationId });
    const jobs = await ctx.db.query("extractionJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).take(JOBS_A_STEP);
    for (const job of jobs) await ctx.scheduler.runAfter(0, internal.extraction.mutations.internal.admin.deleteExtractionInternal, { jobId: job._id });
    if (jobs.length) return (await next(JOBS_WAIT_MS), null);
    if (!(await purgeWorkspaceChats(ctx, workspace._id)) || !(await purgeWorkspace(ctx, workspace._id))) return (await next(0), null);
    await dropWorkspace(ctx, workspace._id);
    return null;
  },
});
