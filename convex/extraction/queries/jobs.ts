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
import { getDocumentSize, v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mergedStream, stream } from "convex-helpers/server/stream";
import schema from "../../schema";
import type { Doc, Id } from "../../_generated/dataModel";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob, type OwnedJobResolution } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { assistantQuery, defineUserQuery, userQuery } from "../../lib/userActions";
import { countRow } from "../../research/recordCounts";
import { readJobCounters } from "../jobCounters";
import { extractionJobValidator, jobQuestionsValidator } from "../validators";
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

/** Most jobs one page of the list holds, and the bytes and rows one read of it takes. */
const JOBS_PAGE_MAX = 50;
const JOBS_PAGE_BYTES = 4 * 1024 * 1024;
const JOBS_FILTER_ROWS = 2_000;

/**
 * The groups the list's status sort puts jobs in: waiting and running first, then finished,
 * then the rest together. A chat has no status and lists with the waiting jobs.
 */
const STATUS_GROUPS = [[undefined, "pending"], ["downloading_pdfs"], ["extracting"], ["completed"], ["failed"], ["cancelled"], ["indexing", "creditsExhausted", "paused"]] as const;

export const jobSortValidator = v.union(v.literal("recent"), v.literal("oldest"), v.literal("name"), v.literal("status"));

export const listJobsAction = defineUserQuery({
  path: "extraction/queries:listJobs",
  description:
    "Lists the person's extraction jobs and chats, a page at a time: newest or oldest first, by name, or by status (waiting and running, then completed, failed and cancelled). " +
    "Given `text`, only those whose name or description contains it.",
  args: { paginationOpts: paginationOptsValidator, sort: jobSortValidator, text: v.optional(v.string()) },
  returns: paginationResultValidator(extractionJobValidator),
  run: async (ctx, userId, { paginationOpts, sort, text }) => {
    await requireFeature(ctx, "extraction.enabled", userId);
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, JOBS_PAGE_MAX), maximumBytesRead: JOBS_PAGE_BYTES };
    const needle = text?.trim().toLowerCase();
    // What a filtered page has read so far: the statuses of one page share one allowance.
    let rows = 0;
    let bytes = 0;
    const matches = async (job: Doc<"extractionJobs">) => {
      rows++;
      bytes += getDocumentSize(job);
      return !needle || job.name.toLowerCase().includes(needle) || (job.description?.toLowerCase().includes(needle) ?? false);
    };
    if (sort === "status") {
      // One group of statuses after another in the list's order, each newest first. The cursor
      // says which group the page stopped in and where. A page is at most `numItems` jobs,
      // however many groups it takes them from.
      const from: { rank: number; after: string | null } = opts.cursor ? JSON.parse(opts.cursor) : { rank: 0, after: null };
      const readGroup = async (rank: number, cursor: string | null, room: number) => {
        const statuses = STATUS_GROUPS[rank].map((status) => stream(ctx.db, schema).query("extractionJobs").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status)).order("desc"));
        const read = await mergedStream(statuses, ["_creationTime"])
          .filterWith(matches)
          .paginate({ cursor, numItems: room, maximumBytesRead: JOBS_PAGE_BYTES - bytes, maximumRowsRead: JOBS_FILTER_ROWS - rows });
        return { jobs: read.page, after: read.isDone ? null : read.continueCursor };
      };
      const page: Doc<"extractionJobs">[] = [];
      for (let rank = from.rank; rank < STATUS_GROUPS.length; rank++) {
        const { jobs, after } = await readGroup(rank, rank === from.rank ? from.after : null, opts.numItems - page.length);
        page.push(...jobs);
        if (after !== null) return { page, isDone: false, continueCursor: JSON.stringify({ rank, after }) };
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
    // The counts live in the job's counts row, not on the job: this query reads that row, so
    // it runs again whenever a count changes.
    const { processed, failed } = await readJobCounters(ctx, args.jobId);

    return ok({
      job,
      totalPapers: job.totalPapers ?? 0,
      processedPapers: processed,
      failedPapers: failed,
    });
  },
});

