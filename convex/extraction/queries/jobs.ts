/**
 * Job-scoped public queries: list the user's jobs, read a job's details,
 * subscribe to job-level progress counters.
 *
 * subscribeToJobProgress intentionally reads only the extractionJobs row
 * (not the paper set) — maybeFinalizeJob/markPaperTerminalTx keep the
 * counters up-to-date so Convex reactivity fires exactly once per
 * transition instead of replaying the full paper set to every tab.
 */

import { query, type QueryCtx } from "../../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import schema from "../../schema";
import type { Doc, Id } from "../../_generated/dataModel";
import { getCurrentUser } from "../../lib/auth";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob, type OwnedJobResolution } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { assistantQuery, defineUserQuery, userQuery } from "../../lib/userActions";
import { countRow } from "../../research/recordCounts";
import { PAPER_LIMIT } from "@/lib/extraction/limits";
import { readJobCounters } from "../jobCounters";
import { extractionJobValidator, extractionQuestionValidator, jobQuestionsValidator, jobStatusValidator } from "../validators";
import { MAX_QUESTIONS_PER_JOB } from "../validators";

async function resolveReadableJob(
  ctx: QueryCtx,
  jobId: Id<"extractionJobs">,
): Promise<OwnedJobResolution> {
  const access = await resolveOwnedJob(ctx, jobId);
  if (access.status !== "ok") return access;
  await requireFeature(ctx, "extraction.enabled");
  return access;
}

export const getMyJobs = query({
  args: {
    status: v.optional(jobStatusValidator),
    mode: v.optional(
      v.union(v.literal("extraction"), v.literal("chat")),
    ),
  },
  returns: v.array(extractionJobValidator),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    await requireFeature(ctx, "extraction.enabled");

    let jobs: Doc<"extractionJobs">[];
    if (args.status) {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", user._id).eq("status", args.status!),
        )
        .order("desc")
        .take(50);
    } else if (args.mode) {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user_mode_updated", (q) =>
          q.eq("userId", user._id).eq("mode", args.mode!),
        )
        .order("desc")
        .take(50);
    } else {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(50);
    }
    return jobs;
  },
});

/** Most jobs one page of the list holds, and the bytes and rows one read of it takes. */
const JOBS_PAGE_MAX = 50;
const JOBS_PAGE_BYTES = 4 * 1024 * 1024;
const JOBS_FILTER_ROWS = 2_000;

/**
 * The order the list's status sort puts jobs in: waiting and running first, then finished,
 * then the rest. A job from before statuses were kept has none and sorts with the waiting.
 */
const STATUS_ORDER = [undefined, "pending", "downloading_pdfs", "extracting", "completed", "failed", "cancelled", "indexing", "creditsExhausted", "paused"] as const;

export const jobSortValidator = v.union(v.literal("recent"), v.literal("oldest"), v.literal("name"), v.literal("status"));

export const listJobsAction = defineUserQuery({
  path: "extraction/queries:listJobs",
  description:
    "Lists the person's extraction jobs and chats, a page at a time: newest or oldest first, by name, or by status (waiting and running, then completed, failed and cancelled). " +
    "Given `text`, only those whose name or description contains it.",
  args: { paginationOpts: paginationOptsValidator, sort: jobSortValidator, text: v.optional(v.string()) },
  returns: paginationResultValidator(extractionJobValidator),
  run: async (ctx, userId, { paginationOpts, sort, text }) => {
    await requireFeature(ctx, "extraction.enabled");
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, JOBS_PAGE_MAX), maximumBytesRead: JOBS_PAGE_BYTES };
    const needle = text?.trim().toLowerCase();
    const matches = async (job: Doc<"extractionJobs">) => !needle || job.name.toLowerCase().includes(needle) || (job.description?.toLowerCase().includes(needle) ?? false);
    if (sort === "status") {
      // One status after another in the list's order, each newest first. The cursor says which
      // status the page stopped in and where.
      let { rank, cursor }: { rank: number; cursor: string | null } = opts.cursor ? JSON.parse(opts.cursor) : { rank: 0, cursor: null };
      const page: Doc<"extractionJobs">[] = [];
      for (; rank < STATUS_ORDER.length; rank++, cursor = null) {
        const status = STATUS_ORDER[rank];
        const read = await stream(ctx.db, schema)
          .query("extractionJobs")
          .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status))
          .order("desc")
          .filterWith(matches)
          .paginate({ cursor, numItems: opts.numItems - page.length, maximumBytesRead: JOBS_PAGE_BYTES, maximumRowsRead: JOBS_FILTER_ROWS });
        page.push(...read.page);
        if (!read.isDone) return { page, isDone: false, continueCursor: JSON.stringify({ rank, cursor: read.continueCursor }) };
      }
      return { page, isDone: true, continueCursor: "" };
    }
    const index = sort === "name" ? "by_user_and_sortName" : "by_user";
    const order = sort === "recent" ? "desc" : "asc";
    return await (needle
      ? stream(ctx.db, schema).query("extractionJobs").withIndex(index, (q) => q.eq("userId", userId)).order(order).filterWith(matches).paginate({ ...opts, maximumRowsRead: JOBS_FILTER_ROWS })
      : ctx.db.query("extractionJobs").withIndex(index, (q) => q.eq("userId", userId)).order(order).paginate(opts));
  },
});
export const listJobs = userQuery(listJobsAction);
export const listJobsForAssistant = assistantQuery(listJobsAction);

export const countJobsAction = defineUserQuery({
  path: "extraction/queries:countJobs",
  description: "Says how many extraction jobs and chats the person has.",
  args: {},
  returns: v.number(),
  // Someone with no job has no count; one from before counts were kept gets theirs from migrations/pagedExtractionJobs.
  run: async (ctx, userId) => (await countRow(ctx, "extractionJobs", userId))?.count ?? 0,
});
export const countJobs = userQuery(countJobsAction);
export const countJobsForAssistant = assistantQuery(countJobsAction);

export const getJobDetails = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    questions: jobQuestionsValidator,
  }),
  handler: async (ctx, args) => {
    const access = await resolveReadableJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { job } = access;

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(MAX_QUESTIONS_PER_JOB);

    return ok({
      job,
      questions,
    });
  },
});

export const getJobShell = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
  }),
  handler: async (ctx, args) => {
    const access = await resolveReadableJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    return ok({ job: access.job });
  },
});

export const subscribeToJobProgress = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
  }),
  handler: async (ctx, args) => {
    const access = await resolveReadableJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { job } = access;
    // Tier B: counts now live in the sharded counter rather than on the
    // job row. Convex query reactivity tracks the counter shards, so the
    // subscription still re-fires on every increment.
    const { processed, failed } = await readJobCounters(ctx, args.jobId);

    return ok({
      job,
      totalPapers: job.totalPapers ?? 0,
      processedPapers: processed,
      failedPapers: failed,
    });
  },
});

/**
 * Public read of the frozen bucket-source rows for a job. Drives the
 * Papers-in-context sidebar in chat mode, but is mode-agnostic — a
 * future extraction-side consumer can reuse it too.
 *
 * Returns the rows ordered by insertion position so the UI list matches
 * the corpus order sent to the model (sorted by openalexId in the
 * prompt renderer, but displayed in user-selection order in the
 * sidebar).
 */
export const getJobSources = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.object({ status: v.literal("unauthenticated") }),
    v.object({ status: v.literal("no_access") }),
    v.object({
      status: v.literal("ok"),
      sources: v.array(schema.doc("extractionJobSources")),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await resolveReadableJob(ctx, args.jobId);
    if (access.status !== "ok") return access;

    const sources = await ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT);

    return { status: "ok" as const, sources };
  },
});
