import type { TestConvexForDataModel } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type OpenArgs = FunctionArgs<typeof internal.screening.mutations.openScreeningJob>;
type FillArgs = FunctionArgs<typeof internal.screening.mutations.fillScreeningJob>;
type JobArgs = Omit<OpenArgs, "userId" | "author" | "papers" | "first" | "last"> & { papers: FillArgs["papers"]; first?: number; last?: number };

/**
 * Starts a job as the signed-in person with these papers, as `screening/start:screen` does: it
 * opens the job, and the papers come in one step, its last. The job's own reading finds it
 * already read.
 */
export async function createJob(as: TestConvexForDataModel<DataModel>, { papers, first = 1, last, ...args }: JobArgs) {
  const user = await as.run((ctx) => requireAuth(ctx));
  const { jobId } = await as.mutation(internal.screening.mutations.openScreeningJob, { userId: user._id, author: "user", first, last: last ?? first + papers.length - 1, papers: papers.length, ...args });
  await as.mutation(internal.screening.mutations.fillScreeningJob, { jobId, papers, read: papers.length, ended: true });
  return { jobId };
}

type JobFields = Omit<Doc<"screeningJobs">, "_id" | "_creationTime" | "screeningId"> & { screeningId?: Id<"screenings"> };

/** A job as rows, for a test that seeds one without starting it: its screening and its progress row with it. */
export async function insertJob(ctx: MutationCtx, fields: JobFields) {
  const screeningId = fields.screeningId ?? (await ctx.db.insert("screenings", { userId: fields.userId, version: 0, createdAt: fields.createdAt }));
  const jobId = await ctx.db.insert("screeningJobs", { ...fields, screeningId });
  await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0 });
  return jobId;
}

/** Counts a seeded, finished result into its job's progress row, as the bookkeeping worker would have. */
export async function countResult(ctx: MutationCtx, result: Doc<"screeningResults">) {
  const row = (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", result.jobId)).unique())!;
  if (result.status === "processing") return;
  await ctx.db.patch("screeningJobProgress", row._id, { [result.status]: row[result.status] + 1, ...(result.status === "completed" && result.qualified ? { qualified: row.qualified + 1 } : {}) });
}
