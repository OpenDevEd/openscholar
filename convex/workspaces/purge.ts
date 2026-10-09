import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** How many rows one step deletes: a search or a saved paper can be near a document's 1 MiB. */
const STEP = 100;

/**
 * Deletes a step's worth of what's in a purged person's own workspace (#650): their screening
 * jobs, searches with their revisions, history and answers, bookmarks, collections and saved
 * papers with their places, and their screening slots. An author profile stays in the directory,
 * owned by nobody, as one whose owner was purged before workspaces is. Chats, extraction jobs and
 * counts have their own purges. Returns whether the workspace is empty of them.
 * ponytail: one step per cleanup run, so a large library takes a run a minute; schedule steps back to back if that's too slow.
 */
export async function purgeWorkspace(ctx: MutationCtx, workspaceId: Id<"workspaces">): Promise<boolean> {
  let left = STEP;
  /** Deletes rows until the step is used up; whether all of them went. */
  const gone = async (rows: { _id: Id<any> }[], table: string) => {
    for (const row of rows) {
      if (left === 0) return false;
      await ctx.db.delete(table as never, row._id as never);
      left--;
    }
    return true;
  };
  const take = () => Math.max(left, 1);
  /** Deletes what a query reads, at most what's left of the step; whether none can be left behind. */
  const drain = async (read: (n: number) => Promise<{ _id: Id<any> }[]>, table: string) => {
    const asked = take();
    const rows = await read(asked);
    return (await gone(rows, table)) && rows.length < asked;
  };

  for (const job of await ctx.db.query("screeningJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(take())) {
    if (!(await drain((n) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(n), "screeningResults"))) return false;
    if (!(await drain((n) => ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(n), "screeningJobProgress"))) return false;
    // A job's own screening, of no search, goes with it; a search's goes with the search.
    const screening = await ctx.db.get("screenings", job.screeningId);
    if (screening && !screening.searchId && !(await purgeScreening(ctx, screening._id, gone, drain))) return false;
    if (!(await gone([job], "screeningJobs"))) return false;
  }

  for (const search of await ctx.db.query("searches").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(take())) {
    if (!(await drain((n) => ctx.db.query("searchRevisions").withIndex("by_search_and_revision", (q) => q.eq("searchId", search._id)).take(n), "searchRevisions"))) return false;
    if (!(await drain((n) => ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_position", (q) => q.eq("searchId", search._id)).take(n), "searchHistory"))) return false;
    for (const screening of await ctx.db.query("screenings").withIndex("by_search", (q) => q.eq("searchId", search._id)).take(take())) {
      if (!(await purgeScreening(ctx, screening._id, gone, drain))) return false;
    }
    if (!(await gone([search], "searches"))) return false;
  }

  if (!(await drain((n) => ctx.db.query("queryShortcuts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(n), "queryShortcuts"))) return false;

  for (const collection of await ctx.db.query("collections").withIndex("by_workspace_sortName", (q) => q.eq("workspaceId", workspaceId)).take(take())) {
    if (!(await drain((n) => ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collection._id)).take(n), "libraryItemCollections"))) return false;
    if (!(await drain((n) => ctx.db.query("evidenceLibraryCollectionSources").withIndex("by_collectionId", (q) => q.eq("collectionId", collection._id)).take(n), "evidenceLibraryCollectionSources"))) return false;
    if (!(await gone([collection], "collections"))) return false;
  }

  for (const item of await ctx.db.query("libraryItems").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(take())) {
    if (!(await drain((n) => ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", item._id)).take(n), "libraryItemCollections"))) return false;
    if (!(await drain((n) => ctx.db.query("paperMetadataChanges").withIndex("by_record", (q) => q.eq("table", "libraryItems").eq("recordId", item._id)).take(n), "paperMetadataChanges"))) return false;
    if (!(await gone([item], "libraryItems"))) return false;
  }

  if (!(await drain((n) => ctx.db.query("screeningSlots").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(n), "screeningSlots"))) return false;

  for (const profile of await ctx.db.query("authorProfiles").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(take())) {
    if (left === 0) return false;
    await ctx.db.patch("authorProfiles", profile._id, { workspaceId: undefined, createdBy: undefined });
    left--;
  }
  return left > 0;
}

/** A screening's answers and their history, then the screening. */
async function purgeScreening(
  ctx: MutationCtx,
  screeningId: Id<"screenings">,
  gone: (rows: { _id: Id<any> }[], table: string) => Promise<boolean>,
  drain: (read: (n: number) => Promise<{ _id: Id<any> }[]>, table: string) => Promise<boolean>,
) {
  if (!(await drain((n) => ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId)).take(n), "screeningAnswers"))) return false;
  if (!(await drain((n) => ctx.db.query("screeningAnswerHistory").withIndex("by_screening_and_version", (q) => q.eq("screeningId", screeningId)).take(n), "screeningAnswerHistory"))) return false;
  return await gone([{ _id: screeningId }], "screenings");
}
