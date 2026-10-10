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
import { countsRow } from "../counts";
import { getDocumentSize, v, type Infer } from "convex/values";
import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import { mergedStream, stream } from "convex-helpers/server/stream";
import schema from "../../schema";
import { searchTerms } from "../../lib/searchText";
import type { Doc, Id } from "../../_generated/dataModel";
import { noAccess, ok, statusResultValidator, unauthenticated } from "../../lib/query_states";
import { ownJob, resolveOwnedJob, type OwnedJobResolution } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { assistantQuery, defineUserQuery, userQuery, workspaceQuery } from "../../lib/userActions";
import { countRow } from "../../research/recordCounts";
import { readJobCounters } from "../jobCounters";
import { extractionJobValidator, jobQuestionsValidator } from "../validators";
import { makersIn, makerValidator } from "../../workspaces/makers";

/** A job as its list shows it: in an organization, with who ran it (#656). */
/** A job as its list shows it: who ran it, in an organization, and its papers done so far, from the counts its workers keep. */
const listedJobValidator = v.object({ ...extractionJobValidator.fields, by: v.optional(makerValidator), done: v.number() });
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
    "Given `text`, those whose name or description best match its words, best first. Given `by`, only the jobs that member ran (their `userId` from workspaces/makers:counts); in an organization each job names who ran it.",
  args: { paginationOpts: paginationOptsValidator, sort: jobSortValidator, text: v.optional(v.string()), by: v.optional(v.id("users")) },
  returns: paginationResultValidator(listedJobValidator),
  run: async (ctx, { userId, workspaceId }, { paginationOpts, sort, text, by }) => {
    await requireFeature(ctx, "extraction.enabled", userId);
    const read = await jobsPage(ctx, workspaceId, { paginationOpts, sort, text, by });
    const makerOf = await makersIn(ctx, workspaceId, userId);
    return {
      ...read,
      page: await Promise.all(read.page.map(async (job) => {
        const [maker, counts] = await Promise.all([makerOf(job.createdBy), readJobCounters(ctx, job._id)]);
        return { ...job, done: counts.processed + counts.failed, ...(maker ? { by: maker } : {}) };
      })),
    };
  },
});
export const listJobs = userQuery(listJobsAction);

/** A page of a workspace's jobs, as listJobs sorts and filters them. */
async function jobsPage(ctx: QueryCtx, workspaceId: Id<"workspaces">, { paginationOpts, sort, text, by }: { paginationOpts: PaginationOptions; sort: Infer<typeof jobSortValidator>; text?: string; by?: Id<"users"> }) {
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, JOBS_PAGE_MAX), maximumBytesRead: JOBS_PAGE_BYTES };
    const needle = searchTerms(text);
    if (needle) return await ctx.db.query("extractionJobs").withSearchIndex("search_text", (q) => (by ? q.search("searchText", needle).eq("workspaceId", workspaceId).eq("createdBy", by) : q.search("searchText", needle).eq("workspaceId", workspaceId))).paginate(opts);
    // What a page by status has read so far: the statuses of one page share one allowance.
    let rows = 0;
    let bytes = 0;
    const matches = async (job: Doc<"extractionJobs">) => {
      rows++;
      bytes += getDocumentSize(job);
      return true;
    };
    if (sort === "status") {
      // One group of statuses after another in the list's order, each newest first. The cursor
      // says which group the page stopped in and where. A page is at most `numItems` jobs,
      // however many groups it takes them from.
      const from: { rank: number; after: string | null } = opts.cursor ? JSON.parse(opts.cursor) : { rank: 0, after: null };
      const readGroup = async (rank: number, cursor: string | null, room: number) => {
        const statuses = STATUS_GROUPS[rank].map((status) => (by
          ? stream(ctx.db, schema).query("extractionJobs").withIndex("by_workspace_and_createdBy_and_status", (q) => q.eq("workspaceId", workspaceId).eq("createdBy", by).eq("status", status))
          : stream(ctx.db, schema).query("extractionJobs").withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", status))).order("desc"));
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
    const order = sort === "recent" ? "desc" : "asc";
    if (by) return await ctx.db.query("extractionJobs").withIndex(sort === "name" ? "by_workspace_and_createdBy_and_sortName" : "by_workspace_and_createdBy", (q) => q.eq("workspaceId", workspaceId).eq("createdBy", by)).order(order).paginate(opts);
    return await ctx.db.query("extractionJobs").withIndex(sort === "name" ? "by_workspace_and_sortName" : "by_workspace", (q) => q.eq("workspaceId", workspaceId)).order(order).paginate(opts);
}
export const listJobsForAssistant = assistantQuery(listJobsAction);

export const countJobsAction = defineUserQuery({
  path: "extraction/queries:countJobs",
  description: "Says how many extraction jobs and chats the person has.",
  args: {},
  returns: v.number(),
  // Someone with no job has no count; one from before counts were kept gets theirs from migrations/pagedExtractionJobs.
  run: async (ctx, { workspaceId }) => (await countRow(ctx, "extractionJobs", workspaceId))?.count ?? 0,
});
export const countJobs = userQuery(countJobsAction);
export const countJobsForAssistant = assistantQuery(countJobsAction);

export const getJobDetailsAction = defineUserQuery({
  path: "extraction/queries:getJobDetails",
  description:
    "Reads one of the person's extraction jobs with its questions, in order: each question's `key`, text, `type` and `description`. " +
    "Use it to say what an extraction asks, and for a question's `key` to summarize or filter its answers by.",
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    questions: jobQuestionsValidator,
  }),
  run: async (ctx, { userId, workspaceId }, { jobId }) => {
    const job = await ownJob(ctx, workspaceId, jobId);
    if (!job) return noAccess();
    await requireFeature(ctx, "extraction.enabled", userId);
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .order("asc")
      .take(MAX_QUESTIONS_PER_JOB);
    return ok({ job, questions });
  },
});
export const getJobDetails = userQuery(getJobDetailsAction, { signedOut: unauthenticated() });
export const getJobDetailsForAssistant = assistantQuery(getJobDetailsAction);

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


/** The statuses of an extraction that's running, which the rail shows as a ring. */
const RUNNING = ["pending", "downloading_pdfs", "indexing", "extracting"] as const;

/** The workspace's newest running extraction, for the rail's ring around Extract (#651): its name and how many of its papers are done. */
export const runningJob = workspaceQuery({
  args: {},
  returns: v.union(v.null(), v.object({ jobId: v.id("extractionJobs"), name: v.string(), done: v.number(), total: v.number() })),
  signedOut: null,
  handler: async (ctx, { workspaceId }) => {
    const newest = await Promise.all(RUNNING.map((status) => ctx.db.query("extractionJobs").withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", status)).order("desc").first()));
    const job = newest.filter((row) => row !== null).sort((a, b) => b._creationTime - a._creationTime)[0];
    if (!job) return null;
    const counts = (await countsRow(ctx, job._id))?.counts;
    const done = counts ? (counts.processed ?? 0) + (counts.failed ?? 0) : (job.processedPapers ?? 0) + (job.failedPapers ?? 0);
    return { jobId: job._id, name: job.name, done, total: job.totalPapers ?? 0 };
  },
});
