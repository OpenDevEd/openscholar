import { query, internalQuery, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { sourceMetadataFields } from "../lib/paperMetadata";
import { sourceMetadata } from "../../lib/library/paper-metadata";
import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import { effortValidator } from "../aiModelConfig/validators";
import { holdOpen } from "../billing/spend";
import type { Doc, Id } from "../_generated/dataModel";
import {
  paperSetValidator,
  saveToValidator,
  screeningAnswersValidator,
  screeningDecisionSourcesValidator,
  screeningConfidencesValidator,
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
import { jobModel, screeningRevision } from "./accounting";
import { getCurrentUser } from "../lib/auth";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { availableCredits } from "../billing/accounts";
import { estimateScreening } from "./estimate";
import { countRow } from "../research/recordCounts";
import { buildScreeningProgressSnapshot, readScreeningProgressCounts } from "./progress";

/** Most screening jobs one page lists; each one also reads its progress. */
const MAX_LISTED_SCREENING_JOBS = 50;

async function readJobProgressSnapshot(
  ctx: QueryCtx,
  job: Pick<Doc<"screeningJobs">, "_id" | "status" | "totalPapers">,
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
  // Papers that failed, papers skipped because the job ended first, and papers the model is reading now.
  failedPapers: v.number(),
  skippedPapers: v.number(),
  running: v.number(),
  // The most it may spend, on a job the assistant started with the person's say (#328), and whether it stopped there.
  spendCap: v.optional(v.number()),
  capped: v.optional(v.boolean()),
  // Its papers are still being read from its search, and why it failed when they couldn't be.
  reading: v.optional(v.boolean()),
  failure: v.optional(v.string()),
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
  return {
    set: job.set,
    label: job.label,
    first: job.first,
    last: job.last,
    through: job.through,
    failedPapers: counts.failedCount,
    skippedPapers: counts.skippedCount,
    running: reading.length,
    ...(job.spendCap === undefined ? {} : { spendCap: job.spendCap }),
    ...(job.capped ? { capped: true } : {}),
    ...(job.reading ? { reading: true } : {}),
    ...(job.failure ? { failure: job.failure } : {}),
  };
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

/** Whether a job is still waiting for its papers: not cancelled, failed or given them meanwhile. */
export const awaitsPapers = internalQuery({
  args: { jobId: v.id("screeningJobs") },
  returns: v.boolean(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    return Boolean(job?.reading && job.status === "processing");
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
export const getScreeningJobAction = defineUserQuery({
  path: "screening/queries:getScreeningJob",
  description: "Read a screening job's source, questions, scoring rules, decision revision and outcome counts. Only the owner can read it.",
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("screeningJobs"),
      _creationTime: v.number(),
      revision: v.string(),
      snapshot: v.optional(searchSnapshotValidator),
      serverEffort: v.optional(effortValidator),
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
      // Papers it saved, and papers it took from the collection it read. Missing for a job from before these were kept.
      saved: v.optional(v.number()),
      removed: v.optional(v.number()),
      // Credits its counted papers cost, of the most they were expected to when it started.
      // No `spent` for a job from before jobs kept what they cost.
      credits: v.object({ spent: v.optional(v.number()), estimate: v.number() }),
    })
  ),
  run: async (ctx, userId, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || job.userId !== userId) return null;
    const progress = await readJobProgressSnapshot(ctx, job);
    const kept = await progressRow(ctx, job._id);
    const counts = await readScreeningProgressCounts(ctx, job);
    const unclear = kept?.unclear ?? 0;
    const target = job.targetCollectionId ? await ctx.db.get("collections", job.targetCollectionId) : null;

    return {
      ...(await factsOf(ctx, job)),
      // A job still to get its papers names the collection it will make.
      ...(target ? { targetCollectionName: target.name } : job.newCollection ? { targetCollectionName: job.newCollection } : {}),
      unsaved: job.unsaved,
      prune: job.prune,
      ...(job.set ? { saved: kept?.saved ?? 0, removed: kept?.removed ?? 0 } : {}),
      credits: { spent: kept?.credits ?? (job.set ? 0 : undefined), estimate: estimateScreening(job.totalPapers - (job.reused ?? 0), 0).credits },
      outcomes: { included: counts.qualifiedCount, unclear, excluded: Math.max(0, counts.completedCount - counts.qualifiedCount - unclear), failed: counts.failedCount },
      tallies: kept?.tallies,
      _id: job._id,
      _creationTime: job._creationTime,
      revision: await screeningRevision(ctx, job),
      snapshot: job.snapshot,
      serverEffort: job.serverEffort,
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
export const getScreeningJob = userQuery(getScreeningJobAction, { signedOut: null });
export const getScreeningJobForAssistant = assistantQuery(getScreeningJobAction);

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

const jobListArgs = { paginationOpts: paginationOptsValidator, status: v.optional(screeningJobStatusValidator) };
const jobListValidator = paginationResultValidator(
    v.object({
      revision: v.string(),
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
  );

/** A page of someone's screening jobs, newest first, each with what it has done so far; with `status`, only the jobs in it. */
async function jobsOf(ctx: QueryCtx, userId: Id<"users">, args: { paginationOpts: PaginationOptions; status?: Doc<"screeningJobs">["status"] }) {
    const { status } = args;
    const jobs = await (status
      ? ctx.db.query("screeningJobs").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status))
      : ctx.db.query("screeningJobs").withIndex("by_user", (q) => q.eq("userId", userId))
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
          revision: await screeningRevision(ctx, job),
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
          targetCollectionName: targetCollection?.name ?? job.newCollection,
        };
      }),
    );
    return { ...jobs, page };
}

/** The person's screening jobs, newest first, a page at a time; with `status`, only the jobs in it. */
export const listUserScreeningJobs = query({
  args: jobListArgs,
  returns: jobListValidator,
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    return await jobsOf(ctx, user._id, args);
  },
});

export const listJobsAction = defineUserQuery({
  path: "screening/queries:listJobs",
  description:
    "Lists the person's screening jobs, newest first, a page at a time: each job's ID and status, how many papers it has, how many are screened, kept (qualified), failed, skipped and being read now, when it started and finished, the questions it asks, where its papers came from, and the collection its kept papers go to. " +
    "With `status`, only the jobs in it. A job's papers are read with screening/papers:list.",
  args: jobListArgs,
  returns: jobListValidator,
  run: async (ctx, userId, args) => jobsOf(ctx, userId, args),
});
export const listJobs = userQuery(listJobsAction);
export const listJobsForAssistant = assistantQuery(listJobsAction);

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
  ...sourceMetadataFields,
  venue: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  resultId: v.id("screeningResults"),
  openalexId: v.string(),
  title: v.string(),
  authors: screeningAuthorsValidator,
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
  status: screeningResultStatusValidator,
  answers: screeningAnswersValidator,
  modelAnswers: screeningAnswersValidator,
  modelConfidences: screeningConfidencesValidator,
  decisions: screeningDecisionSourcesValidator,
  outcome: v.optional(v.string()),
  model: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  score: v.optional(v.number()),
  stars: v.optional(v.number()),
  qualified: v.optional(v.boolean()),
});

/** Most results one page of a job holds; each also reads its answers. */
const RESULTS_PAGE_MAX = 200;

/** Scored decisions and their original model answers, in the job's order. */
export async function readScreeningResultsPage(ctx: QueryCtx, job: Doc<"screeningJobs">, paginationOpts: PaginationOptions) {
  const results = await ctx.db
    .query("screeningResults")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, RESULTS_PAGE_MAX) });
  const models = await Promise.all(results.page.map((result) => result.doneAt === undefined ? jobModel(ctx, job, result) : undefined));
  return {
    ...results,
    page: results.page.map((r, i) => {
      const pending = r.doneAt !== undefined || r.status === "processing";
      const answers = pending ? undefined : r.counted?.answers ?? models[i]?.answers;
      return {
        resultId: r._id,
        ...sourceMetadata(r),
        venue: r.venue,
        citedByCount: r.citedByCount,
        openalexId: r.openalexId,
        title: r.title,
        authors: r.authors,
        publicationYear: r.publicationYear,
        doi: r.doi,
        status: pending ? "processing" as const : r.status,
        answers,
        modelAnswers: models[i]?.answers,
        modelConfidences: models[i]?.confidences,
        decisions: answers ? Object.fromEntries(Object.keys(answers).map((key) => [key, r.counted?.decisions?.[key] ?? { by: "unrecorded" as const }])) : undefined,
        outcome: pending ? undefined : r.outcome,
        model: pending ? undefined : r.aiMetadata?.model,
        completedAt: pending ? undefined : r.completedAt,
        score: pending ? undefined : r.score,
        stars: pending ? undefined : r.stars,
        qualified: pending ? undefined : r.qualified,
      };
    }),
  };
}
export type ScreeningResultRow = Awaited<ReturnType<typeof readScreeningResultsPage>>["page"][number];

/** One page of the results of a job the person owns; an empty page for anyone else. */
export const listScreeningResultsAction = defineUserQuery({
  path: "screening/queries:listScreeningResults",
  description: "Read a page of a screening job's scored decisions with original model answers and decision provenance. Pass the job revision to reject changes between pages.",
  args: { jobId: v.id("screeningJobs"), paginationOpts: paginationOptsValidator, revision: v.optional(v.string()) },
  returns: paginationResultValidator(screeningResultRowValidator),
  run: async (ctx, userId, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || job.userId !== userId) return { page: [], isDone: true, continueCursor: "" };
    await screeningRevision(ctx, job, args.revision);
    return await readScreeningResultsPage(ctx, job, args.paginationOpts);
  },
});
export const listScreeningResults = userQuery(listScreeningResultsAction, { signedOut: { page: [], isDone: true, continueCursor: "" } });
export const listScreeningResultsForAssistant = assistantQuery(listScreeningResultsAction);

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
        // The most it may spend, what its counted papers have cost so far, and whether it has stopped there, on a job that has a limit.
        spendCap: v.optional(v.number()),
        spendHold: v.optional(v.string()),
        spent: v.optional(v.number()),
        capped: v.optional(v.boolean()),
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
      job: {
        userId: job.userId,
        status: job.status,
        totalPapers: job.totalPapers,
        questions: job.questions,
        serverEffort: job.serverEffort,
        // Only a job with a limit reads what it has spent: every other paper is spared the read.
        ...(job.spendCap === undefined ? {} : { spendCap: job.spendCap, spent: (await progressRow(ctx, jobId))?.credits ?? 0, ...(job.capped ? { capped: true } : {}) }),
        // Its papers are charged under its hold while the hold takes them; past that, each pays its own way, still within the figure.
        ...(job.spendHold !== undefined && (await holdOpen(ctx, job.spendHold)) ? { spendHold: job.spendHold } : {}),
      },
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
