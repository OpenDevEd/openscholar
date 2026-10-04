/**
 * What the extraction job list needs kept on each job as it changes: the name it sorts by.
 * No Convex functions live here, so the triggers can load it (../lib/triggers.ts).
 */
import type { Change } from "convex-helpers/server/triggers";
import type { DataModel } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { collectionSortName } from "../library/sortName";

/** Keeps a job's `sortName` equal to its name as lists order names, whichever function names or renames it. */
export async function nameJob(ctx: MutationCtx, change: Change<DataModel, "extractionJobs">) {
  const job = change.newDoc;
  if (!job) return;
  const sortName = collectionSortName(job.name);
  if (job.sortName !== sortName) await ctx.db.patch(job._id, { sortName });
}
