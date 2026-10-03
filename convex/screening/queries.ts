import { query, internalQuery, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import { effortValidator } from "../aiModelConfig/validators";
import type { Doc } from "../_generated/dataModel";
import {
  paperSetValidator,
  saveToValidator,
  screeningAnswersValidator,
  screeningAuthorsValidator,
  screeningJobStatusValidator,
  screeningQuestionsValidator,
  screeningResultStatusValidator,
  screeningScoringConfigValidator,
  screeningTalliesValidator,
} from "./validators";
import { progressRow } from "./bookkeeping";
import { paperLimit } from "./slots";
import { searchSnapshotValidator } from "../paperSets/openalex";
import { answeredFully, screeningFor } from "../research/answers";
import { SCREENING_POOL_SIZE } from "../workpool";
import { jobAnswers } from "./accounting";
import { getCurrentUser } from "../lib/auth";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { availableCredits } from "../billing/accounts";
import { estimateScreening } from "./estimate";
import { countRow } from "../research/recordCounts";
import { readScreeningProgressCounts } from "./aggregates";
import { buildScreeningProgressSnapshot } from "./progress";

/** Most screening jobs one page lists; each one also reads its progress. */
const MAX_LISTED_SCREENING_JOBS = 50;

async function readJobProgressSnapshot(
  ctx: QueryCtx,
  job: Pick<Doc<"screeningJobs">, "_id" | "status" | "totalPapers" | "resultCounts">,
) {
  const counts = await readScreeningProgressCounts(ctx, job);
  return buildScreeningProgressSnapshot({
    status: job.status,
    totalPapers: job.totalPapers,
    ...counts,
  });
}

/** What the screening page shows of a job beside its progress, in its list and on its own view. */
const jobFacts = {
  // Where its papers came from, the set's name when it started, and which of its papers.
  set: v.optional(paperSetValidator),
  label: v.optional(v.string()),
  first: v.optional(v.number()),
  last: v.optional(v.number()),
  through: v.optional(v.number()),
  // Papers that failed, and papers the model is reading now.
  failedPapers: v.number(),
  running: v.number(),
};

async function factsOf(ctx: QueryCtx, job: Doc<"screeningJobs">) {
  const [counts, reading] = await Promise.all([
    readScreeningProgressCounts(ctx, job),
    // Only a running job has papers being read, and never more than the pool holds.
    job.status === "processing"
      ? ctx.db
          .query("screeningResults")
          .withIndex("by_job_and_status_and_waitingUser", (q) => q.eq("jobId", job._id).eq("status", "processing").eq("waitingUser", undefined))
          .take(SCREENING_POOL_SIZE)
      : [],
  ]);
  return { set: job.set, label: job.label, first: job.first, last: job.last, through: job.through, failedPapers: counts.failedCount, running: reading.length };
}

/**
 * The person's paper slots (#335): how many papers they may have running at once across
 * their jobs, and how many are running.
 */
export const slotsAction = defineUserQuery({
  path: "screening/queries:slots",
  description: "The person's paper slots for screening: how many papers they may have running at once across their screening jobs, and how many are running now.",
  args: {},
  returns: v.object({ limit: v.number(), running: v.number() }),
  run: async (ctx, userId) => {
    const row = await ctx.db.query("screeningSlots").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    return { limit: await paperLimit(ctx, userId), running: row?.running ?? 0 };
  },
});
export const slots = userQuery(slotsAction);
export const slotsForAssistant = assistantQuery(slotsAction);

/** Papers one read checks for answers: each is an indexed read of a row of up to 50 answers. */
const ANSWERED_PAPERS_MAX = 250;

/** How many of these papers the person's search already answers every one of `questions` for, on its page. */
export const answeredCount = internalQuery({
  args: { userId: v.id("users"), searchId: v.string(), questions: v.array(v.string()), paperIds: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, { userId, searchId, questions, paperIds }) => {
    if (paperIds.length > ANSWERED_PAPERS_MAX) throw new Error(`Answered papers are counted ${ANSWERED_PAPERS_MAX} at a time`);
    const search = await ctx.db.query("searches").withIndex("by_user_and_localId", (q) => q.eq("userId", userId).eq("localId", searchId)).unique();
    const screening = search && (await screeningFor(ctx, search._id));
    return screening ? (await answeredFully(ctx, screening, questions, paperIds)).size : 0;
  },
});

/**
 * A completed job of a request that goes on past it, as the request's next job takes it
 * over: its papers' set, where the request ends, and the questions, rules and destination.
 */
export const requestJob = internalQuery({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      set: paperSetValidator,
      through: v.number(),
      label: v.optional(v.string()),
      resume: v.optional(v.string()),
      snapshot: v.optional(searchSnapshotValidator),
      questions: screeningQuestionsValidator,
      scoringConfig: screeningScoringConfigValidator,
      saveTo: v.optional(saveToValidator),
      prune: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.status !== "completed" || !job.set || job.through === undefined) return null;
    const saveTo = job.unsaved ? { kind: "none" as const } : job.targetCollectionId ? { kind: "collection" as const, collectionId: job.targetCollectionId } : undefined;
    return {
      userId: job.userId, set: job.set, through: job.through, questions: job.questions, scoringConfig: job.scoringConfig,
      ...(job.label ? { label: job.label } : {}),
      ...(job.resume ? { resume: job.resume } : {}),
      ...(job.snapshot ? { snapshot: job.snapshot } : {}),
      ...(saveTo ? { saveTo } : {}),
      ...(job.prune ? { prune: true } : {}),
    };
  },
});

/**
 * Get real-time progress of a screening job.
 *
 * Returns a reactive progress object for the UI, or null if:
 * - User is not authenticated
 * - Job does not exist
 * - Job belongs to another user (user isolation, no info leak)
 */
export const getScreeningProgress = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      qualifiedPapers: v.number(),
      percentComplete: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || job.userId !== user._id) return null;
    return await readJobProgressSnapshot(ctx, job);
  },
});

/**
 * Get the full screening job record.
 *
 * Returns the complete job document for the authenticated owner, or null
 * if the user is not authenticated, the job doesn't exist, or it belongs
 * to another user.
 */
export const getScreeningJob = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("screeningJobs"),
      _creationTime: v.number(),
      userId: v.id("users"),
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      qualifiedPapers: v.number(),
      questions: screeningQuestionsValidator,
      scoringConfig: screeningScoringConfigValidator,
      targetCollectionId: v.optional(v.id("collections")),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
      // Its papers by where they landed, and how each question was answered; kept as papers settle.
      outcomes: v.object({ included: v.number(), unclear: v.number(), excluded: v.number(), failed: v.number() }),
      tallies: screeningTalliesValidator,
      ...jobFacts,
      // The collection its included papers go to, while it exists; `unsaved` when they go nowhere.
      targetCollectionName: v.optional(v.string()),
      unsaved: v.optional(v.literal(true)),
      prune: v.optional(v.literal(true)),
      // Credits its counted papers cost, of the most they were expected to when it started.
      // No `spent` for a job from before jobs kept what they cost.
      credits: v.object({ spent: v.optional(v.number()), estimate: v.number() }),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || job.userId !== user._id) return null;
    const progress = await readJobProgressSnapshot(ctx, job);
    const kept = await progressRow(ctx, job._id);
    const counts = await readScreeningProgressCounts(ctx, job);
    const unclear = kept?.unclear ?? 0;
    const target = job.targetCollectionId ? await ctx.db.get("collections", job.targetCollectionId) : null;

    return {
      ...(await factsOf(ctx, job)),
      ...(target ? { targetCollectionName: target.name } : {}),
      unsaved: job.unsaved,
      prune: job.prune,
      credits: { spent: kept?.credits ?? (job.set ? 0 : undefined), estimate: estimateScreening(job.totalPapers - (job.reused ?? 0), 0).credits },
      outcomes: { included: counts.qualifiedCount, unclear, excluded: Math.max(0, counts.completedCount - counts.qualifiedCount - unclear), failed: counts.failedCount },
      tallies: kept?.tallies,
      _id: job._id,
      _creationTime: job._creationTime,
      userId: job.userId,
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: progress.processedPapers,
      qualifiedPapers: progress.qualifiedPapers,
      questions: job.questions,
      scoringConfig: job.scoringConfig,
      targetCollectionId: job.targetCollectionId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  },
});

/**
 * Get the latest active screening job progress for the authenticated user.
 *
 * Returns the newest processing job with aggregate-backed progress for shell UI,
 * or null when the user is unauthenticated or has no active job.
 */
export const getActiveScreeningJobProgress = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("screeningJobs"),
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      qualifiedPapers: v.number(),
      percentComplete: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const activeJob = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "processing"),
      )
      .order("desc")
      .first();

    if (!activeJob) return null;

    const progress = await readJobProgressSnapshot(ctx, activeJob);
    return {
      jobId: activeJob._id,
      status: activeJob.status,
      totalPapers: activeJob.totalPapers,
      processedPapers: progress.processedPapers,
      failedPapers: progress.failedPapers,
      qualifiedPapers: progress.qualifiedPapers,
      percentComplete: progress.percentComplete,
    };
  },
});

/** The person's screening jobs, newest first, a page at a time; with `status`, only the jobs in it. */
export const listUserScreeningJobs = query({
  args: { paginationOpts: paginationOptsValidator, status: v.optional(screeningJobStatusValidator) },
  returns: paginationResultValidator(
    v.object({
      _id: v.id("screeningJobs"),
      _creationTime: v.number(),
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      qualifiedPapers: v.number(),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
      questions: screeningQuestionsValidator,
      targetCollectionId: v.optional(v.id("collections")),
      targetCollectionName: v.optional(v.string()),
      ...jobFacts,
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };

    const { status } = args;
    const jobs = await (status
      ? ctx.db.query("screeningJobs").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", status))
      : ctx.db.query("screeningJobs").withIndex("by_user", (q) => q.eq("userId", user._id))
    )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, MAX_LISTED_SCREENING_JOBS) });

    const page = await Promise.all(
      jobs.page.map(async (job) => {
        const [progress, targetCollection, facts] = await Promise.all([
          readJobProgressSnapshot(ctx, job),
          job.targetCollectionId
            ? ctx.db.get("collections", job.targetCollectionId)
            : Promise.resolve(null),
          factsOf(ctx, job),
        ]);

        return {
          ...facts,
          _id: job._id,
          _creationTime: job._creationTime,
          status: job.status,
          totalPapers: job.totalPapers,
          processedPapers: progress.processedPapers,
          qualifiedPapers: progress.qualifiedPapers,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          questions: job.questions,
          targetCollectionId: job.targetCollectionId,
          targetCollectionName: targetCollection?.name,
        };
      }),
    );
    return { ...jobs, page };
  },
});

/** How many screening jobs the person has, from the kept count (research/recordCounts.ts). */
export const countUserScreeningJobs = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    // Someone with no job has no count; one from before counts were kept gets theirs from migrations/countScreeningJobs.
    return user ? ((await countRow(ctx, "screeningJobs", user._id))?.count ?? 0) : 0;
  },
});

const screeningResultRowValidator = v.object({
  openalexId: v.string(),
  title: v.string(),
  authors: screeningAuthorsValidator,
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
  status: screeningResultStatusValidator,
  answers: screeningAnswersValidator,
  score: v.optional(v.number()),
  stars: v.optional(v.number()),
  qualified: v.optional(v.boolean()),
});

/** Most results one page of a job holds; each also reads its answers. */
const RESULTS_PAGE_MAX = 200;

/**
 * One page of a job's results, any status, in the order they were made, each with what the
 * job answered. No `aiMetadata` or abstract: an export doesn't write them.
 */
export async function readScreeningResultsPage(ctx: QueryCtx, job: Doc<"screeningJobs">, paginationOpts: PaginationOptions) {
  const results = await ctx.db
    .query("screeningResults")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, RESULTS_PAGE_MAX) });
  const answers = await Promise.all(results.page.map((result) => jobAnswers(ctx, job, result)));
  return {
    ...results,
    page: results.page.map((r, i) => ({
      openalexId: r.openalexId,
      title: r.title,
      authors: r.authors,
      publicationYear: r.publicationYear,
      doi: r.doi,
      status: r.status,
      answers: answers[i],
      score: r.score,
      stars: r.stars,
      qualified: r.qualified,
    })),
  };
}
export type ScreeningResultRow = Awaited<ReturnType<typeof readScreeningResultsPage>>["page"][number];

/** One page of the results of a job the person owns; an empty page for anyone else. */
export const listScreeningResults = query({
  args: { jobId: v.id("screeningJobs"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(screeningResultRowValidator),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = user ? await ctx.db.get("screeningJobs", args.jobId) : null;
    if (!user || !job || job.userId !== user._id) return { page: [], isDone: true, continueCursor: "" };
    return await readScreeningResultsPage(ctx, job, args.paginationOpts);
  },
});

// ═══════════════════════════════════════════════════════════════
// INTERNAL QUERIES (for workpool/background context)
// ═══════════════════════════════════════════════════════════════

/**
 * Everything a Screen all paper's action needs, in one read: its job, the paper, the
 * person (for analytics), their cached balance (bulk work runs while it has credits), and
 * the job's model with its pricing.
 */
export const paperContext = internalQuery({
  args: { jobId: v.id("screeningJobs"), resultId: v.id("screeningResults") },
  returns: v.union(
    v.null(),
    v.object({
      job: v.object({
        userId: v.id("users"),
        status: screeningJobStatusValidator,
        totalPapers: v.number(),
        questions: screeningQuestionsValidator,
        serverEffort: v.optional(effortValidator),
      }),
      paper: v.object({ title: v.string(), abstract: v.optional(v.string()), status: screeningResultStatusValidator }),
      clerkId: v.string(),
      balance: v.number(),
      // Null when the job runs the default; `available: false` when its model was hidden or retired since.
      model: v.union(v.null(), v.object({ slug: v.string(), input: v.number(), output: v.number(), available: v.boolean() })),
    }),
  ),
  handler: async (ctx, { jobId, resultId }) => {
    const [job, paper] = await Promise.all([ctx.db.get("screeningJobs", jobId), ctx.db.get("screeningResults", resultId)]);
    if (!job || !paper) return null;
    const [user, balance, model] = await Promise.all([
      ctx.db.get("users", job.userId),
      availableCredits(ctx, job.userId),
      job.serverModelId ? ctx.db.get("models", job.serverModelId) : null,
    ]);
    if (!user) return null;
    return {
      job: { userId: job.userId, status: job.status, totalPapers: job.totalPapers, questions: job.questions, serverEffort: job.serverEffort },
      paper: { title: paper.title, abstract: paper.abstract, status: paper.status },
      clerkId: user.clerkId,
      balance,
      model: model
        ? {
            slug: model.modelId,
            input: model.inputPricePerMillion,
            output: model.outputPricePerMillion,
            available: model.retiredAt === undefined && !model.hidden,
          }
        : null,
    };
  },
});

export const estimateAction = defineUserQuery({
  path: "screening/queries:estimate",
  description: "Estimates the credits screening a number of papers holds, against the person's balance, and how many papers that balance covers.",
  args: { papers: v.number() },
  returns: v.object({ credits: v.number(), available: v.number(), affordablePapers: v.number() }),
  run: async (ctx, userId, args) => estimateScreening(args.papers, await availableCredits(ctx, userId)),
});
export const estimate = userQuery(estimateAction);
export const estimateForAssistant = assistantQuery(estimateAction);
