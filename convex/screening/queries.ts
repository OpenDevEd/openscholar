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
import { progressOf, progressRow } from "./bookkeeping";
import { paperLimit } from "./slots";
import { searchSnapshotValidator } from "../paperSets/openalex";
import { jobModel, screeningRevision } from "./accounting";
import { getCurrentUser } from "../lib/auth";
import { assistantQuery, defineUserQuery, userQuery, workspaceQuery } from "../lib/userActions";
import { actorIn, type InWorkspace } from "../workspaces/actor";
import { workspaceFrom } from "../workspaces/personal";
import { countOf } from "../lib/listCounts";
import { guestRole, itemGuestsOf } from "../sharing/items";
import { guestRoleValidator, sharedFromValidator } from "../sharing/validators";
import { readableJob } from "./access";
import { makersIn, makerValidator } from "../workspaces/makers";
import { availableCredits } from "../billing/accounts";
import { estimateScreening, screeningPaperCreditsFor } from "./estimate";
import { pricingOf } from "../ai/serverModel";
import { screeningPaperCredits } from "../../lib/pricing";
import { countRow } from "../research/recordCounts";
import { buildScreeningProgressSnapshot, readScreeningProgressCounts } from "./progress";
import { paperKeyOf } from "../../lib/papers/paper-ref";
import { crossRefsValidator } from "../lib/paperRef";

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
  // Its own name, given as it started; without one the page names it after `label`.
  name: v.optional(v.string()),
  // Where its papers came from, the set's name when it started, and which of its papers.
  set: v.optional(paperSetValidator),
  label: v.optional(v.string()),
  first: v.optional(v.number()),
  last: v.optional(v.number()),
  // The end of the range a chained request from before #635 asked for, past its job's `last`: what running it again takes.
  through: v.optional(v.number()),
  // Papers that failed, papers skipped because the job ended first, and papers in a slot: started, and not counted off yet.
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
  // The job's own count of its papers in a slot, the one its workspace's slots are counted from: the two agree, and a paper
  // that finished stays in it until it's counted, so what's counted, what's being read and what waits always add up to the job.
  const [counts, progress] = await Promise.all([readScreeningProgressCounts(ctx, job), progressOf(ctx, job._id)]);
  return {
    set: job.set,
    ...(job.name ? { name: job.name } : {}),
    label: job.label,
    first: job.first,
    last: job.last,
    through: job.through,
    failedPapers: counts.failedCount,
    skippedPapers: counts.skippedCount,
    // Only a running job has papers being read.
    running: job.status === "processing" ? (progress.running ?? 0) : 0,
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
  description: "The workspace's paper slots for screening: how many papers it may have running at once across its screening jobs, and how many are running now.",
  args: {},
  returns: v.object({ limit: v.number(), running: v.number() }),
  run: async (ctx, { workspaceId }) => {
    const row = await ctx.db.query("screeningSlots").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
    return { limit: await paperLimit(ctx, workspaceId), running: row?.running ?? 0 };
  },
});
export const slots = userQuery(slotsAction);
export const slotsForAssistant = assistantQuery(slotsAction);

/** What a reading job reads next: its set and range, how far it has read. Null once it isn't reading. */
export const readingJob = internalQuery({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      workspaceId: v.id("workspaces"),
      set: paperSetValidator,
      first: v.number(),
      last: v.number(),
      read: v.number(),
      resume: v.optional(v.string()),
      snapshot: v.optional(searchSnapshotValidator),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job?.reading || job.status !== "processing" || !job.set || job.first === undefined || job.last === undefined) return null;
    return {
      userId: job.createdBy, workspaceId: job.workspaceId, set: job.set, first: job.first, last: job.last, read: job.readPlace?.read ?? 0,
      ...(job.resume ? { resume: job.resume } : {}),
      ...(job.snapshot ? { snapshot: job.snapshot } : {}),
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
    if (!job || !(await actorIn(ctx, user, job.workspaceId))) return null;
    return await readJobProgressSnapshot(ctx, job);
  },
});

/**
 * A screening job as its page shows it, for its workspace's members and for a guest of it
 * (#653); null for anyone else, and when it doesn't exist.
 */
export const getScreeningJobAction = defineUserQuery({
  path: "screening/queries:getScreeningJob",
  description:
    "Read a screening job's source, questions, scoring rules, decision revision and outcome counts. Its workspace's members read it, with `guests`: how many people outside the workspace it's shared with, invitations still waiting included. " +
    "Someone it's shared with reads it from their own workspace, with `guest`: what they may do with it and whose it is, and `source`, the kind of thing its papers came from. They get neither what it cost, where its papers went, nor the ID of the collection, search or screening they came from: those are its workspace's. What was searched (`snapshot`) is the screening's own, and a guest reads it.",
  // The Screening page reads the ID from its address: text that is no screening's ID answers null, as a screening that is gone does (#826).
  args: { jobId: v.string() },
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
      // No `spent` for a job from before jobs kept what they cost. Its workspace's alone: a guest gets none.
      credits: v.optional(v.object({ spent: v.optional(v.number()), estimate: v.number() })),
      // How many people outside its workspace it's shared with, for its members; what a guest may do with it and whose it is, for a guest (#653).
      guests: v.optional(v.number()),
      guest: v.optional(v.object({ role: guestRoleValidator, from: sharedFromValidator })),
      // For a guest, in place of `set`: the kind of thing its papers came from, and not which one. Its name is `label`, as the job itself goes by it.
      source: v.optional(v.union(v.literal("search"), v.literal("collection"), v.literal("saved"), v.literal("screening"), v.literal("zotero"), v.literal("evidenceLibrary"))),
    })
  ),
  run: async (ctx, actor, args) => {
    const jobId = ctx.db.normalizeId("screeningJobs", args.jobId);
    const job = jobId ? await ctx.db.get("screeningJobs", jobId) : null;
    if (!job) return null;
    const role = job.workspaceId === actor.workspaceId ? null : await guestRole(ctx, actor, job);
    if (job.workspaceId !== actor.workspaceId && !role) return null;
    const progress = await readJobProgressSnapshot(ctx, job);
    const kept = await progressRow(ctx, job._id);
    const counts = await readScreeningProgressCounts(ctx, job);
    const unclear = kept?.unclear ?? 0;
    const target = job.targetCollectionId ? await ctx.db.get("collections", job.targetCollectionId) : null;
    const { spendCap, set, ...facts } = await factsOf(ctx, job);
    // What it cost, the most it may spend, the collections its papers went to and the ID of what they came from are its workspace's.
    // What was searched (`snapshot`) holds no ID and is the screening's own: a guest reads it, and their export gives it.
    const own = role
      ? { guest: { role, from: await workspaceFrom(ctx, job.workspaceId) }, ...(set ? { source: set.kind } : {}) }
      : {
          set,
          ...(spendCap === undefined ? {} : { spendCap }),
          // A job still to get its papers names the collection it will make.
          ...(target ? { targetCollectionName: target.name } : job.newCollection ? { targetCollectionName: job.newCollection } : {}),
          targetCollectionId: job.targetCollectionId,
          ...(job.set ? { saved: kept?.saved ?? 0, removed: kept?.removed ?? 0 } : {}),
          credits: { spent: kept?.credits ?? (job.set ? 0 : undefined), estimate: estimateScreening(job.totalPapers - (job.reused ?? 0), 0, screeningPaperCredits(await pricingOf(ctx, job.serverModelId))).credits },
          guests: await countOf(ctx, itemGuestsOf(job._id)),
        };

    return {
      ...facts,
      ...own,
      unsaved: job.unsaved,
      prune: job.prune,
      outcomes: { included: counts.qualifiedCount, unclear, excluded: Math.max(0, counts.completedCount - counts.qualifiedCount - unclear), failed: counts.failedCount },
      tallies: kept?.tallies,
      _id: job._id,
      _creationTime: job._creationTime,
      revision: await screeningRevision(ctx, job),
      snapshot: job.snapshot,
      serverEffort: job.serverEffort,
      userId: job.createdBy,
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: progress.processedPapers,
      qualifiedPapers: progress.qualifiedPapers,
      questions: job.questions,
      scoringConfig: job.scoringConfig,
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
export const getActiveScreeningJobProgress = workspaceQuery({
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
  signedOut: null,
  handler: async (ctx, { workspaceId }) => {
    const activeJob = await ctx.db
      .query("screeningJobs")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "processing"),
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

// `by`: only the jobs that member ran (#656).
const jobListArgs = { paginationOpts: paginationOptsValidator, status: v.optional(screeningJobStatusValidator), by: v.optional(v.id("users")) };
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
      // Who ran it, in an organization.
      by: v.optional(makerValidator),
    }),
  );

/** A page of a workspace's screening jobs, newest first, each with what it has done so far; with `status`, only the jobs in it; with `by`, only that member's. */
async function jobsOf(ctx: QueryCtx, { userId, workspaceId }: InWorkspace, args: { paginationOpts: PaginationOptions; status?: Doc<"screeningJobs">["status"]; by?: Id<"users"> }) {
    const { status, by } = args;
    const jobs = await (by
      ? status
        ? ctx.db.query("screeningJobs").withIndex("by_workspace_and_createdBy_and_status", (q) => q.eq("workspaceId", workspaceId).eq("createdBy", by).eq("status", status))
        : ctx.db.query("screeningJobs").withIndex("by_workspace_and_createdBy", (q) => q.eq("workspaceId", workspaceId).eq("createdBy", by))
      : status
        ? ctx.db.query("screeningJobs").withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", status))
        : ctx.db.query("screeningJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, MAX_LISTED_SCREENING_JOBS) });

    const makerOf = await makersIn(ctx, workspaceId, userId);
    const page = await Promise.all(
      jobs.page.map(async (job) => {
        const [progress, targetCollection, facts, maker] = await Promise.all([
          readJobProgressSnapshot(ctx, job),
          job.targetCollectionId
            ? ctx.db.get("collections", job.targetCollectionId)
            : Promise.resolve(null),
          factsOf(ctx, job),
          makerOf(job.createdBy),
        ]);

        return {
          ...facts,
          ...(maker ? { by: maker } : {}),
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

/** The workspace's screening jobs, newest first, a page at a time; with `status`, only the jobs in it. */
export const listUserScreeningJobs = workspaceQuery({
  args: jobListArgs,
  returns: jobListValidator,
  signedOut: { page: [], isDone: true, continueCursor: "" },
  handler: (ctx, actor, args) => jobsOf(ctx, actor, args),
});

export const listJobsAction = defineUserQuery({
  path: "screening/queries:listJobs",
  description:
    "Lists the person's screening jobs, newest first, a page at a time: each job's ID and status, how many papers it has, how many are screened, kept (qualified), failed, skipped and being read now, when it started and finished, the questions it asks, where its papers came from, and the collection its kept papers go to. " +
    "With `status`, only the jobs in it. A job's papers are read with screening/papers:list.",
  args: jobListArgs,
  returns: jobListValidator,
  run: async (ctx, actor, args) => jobsOf(ctx, actor, args),
});
export const listJobs = userQuery(listJobsAction);
export const listJobsForAssistant = assistantQuery(listJobsAction);

/** How many screening jobs the person has, from the kept count (research/recordCounts.ts). */
export const countUserScreeningJobs = workspaceQuery({
  args: {},
  returns: v.number(),
  signedOut: 0,
  // Someone with no job has no count; one from before counts were kept gets theirs from migrations/countScreeningJobs.
  handler: async (ctx, { workspaceId }) => (await countRow(ctx, "screeningJobs", workspaceId))?.count ?? 0,
});

const screeningResultRowValidator = v.object({
  ...sourceMetadataFields,
  venue: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  resultId: v.id("screeningResults"),
  paper: v.string(),
  crossRefs: v.optional(crossRefsValidator),
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
        paper: paperKeyOf(r),
        ...(r.crossRefs ? { crossRefs: r.crossRefs } : {}),
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

/** One page of the results of a job the person may read; an empty page for anyone else. */
export const listScreeningResultsAction = defineUserQuery({
  path: "screening/queries:listScreeningResults",
  description: "Read a page of a screening job's scored decisions with original model answers and decision provenance. Pass the job revision to reject changes between pages.",
  args: { jobId: v.id("screeningJobs"), paginationOpts: paginationOptsValidator, revision: v.optional(v.string()) },
  returns: paginationResultValidator(screeningResultRowValidator),
  run: async (ctx, actor, args) => {
    const job = await readableJob(ctx, actor, args.jobId);
    if (!job) return { page: [], isDone: true, continueCursor: "" };
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
        // The workspace it's in, which pays for its papers (#650).
        workspaceId: v.id("workspaces"),
        status: screeningJobStatusValidator,
        totalPapers: v.number(),
        questions: screeningQuestionsValidator,
        serverEffort: v.optional(effortValidator),
        // The most it may spend, what its counted papers have cost so far, and whether it has stopped there, on a job that has a limit.
        spendCap: v.optional(v.number()),
        // The hold the figure is kept in, and whether it still takes papers.
        spendHold: v.optional(v.string()),
        held: v.optional(v.boolean()),
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
    const workspaceId = job.workspaceId;
    const [user, balance, model] = await Promise.all([
      ctx.db.get("users", job.createdBy),
      availableCredits(ctx, workspaceId),
      job.serverModelId ? ctx.db.get("models", job.serverModelId) : null,
    ]);
    if (!user) return null;
    return {
      job: {
        userId: job.createdBy,
        workspaceId,
        status: job.status,
        totalPapers: job.totalPapers,
        questions: job.questions,
        serverEffort: job.serverEffort,
        // Only a job with a limit reads what it has spent: every other paper is spared the read.
        ...(job.spendCap === undefined ? {} : { spendCap: job.spendCap, spent: (await progressRow(ctx, jobId))?.credits ?? 0, ...(job.capped ? { capped: true } : {}) }),
        ...(job.spendHold === undefined ? {} : { spendHold: job.spendHold, held: await holdOpen(ctx, job.spendHold) }),
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
  description: "Estimates the credits screening a number of papers holds, against the workspace's balance, and how many papers that balance covers. A member with a monthly cap spends within what's left of it, which billing/caps:allowance says.",
  args: { papers: v.number() },
  returns: v.object({ credits: v.number(), available: v.number(), affordablePapers: v.number() }),
  run: async (ctx, { userId, workspaceId }, args) => estimateScreening(args.papers, await availableCredits(ctx, workspaceId), await screeningPaperCreditsFor(ctx, { userId, workspaceId })),
});
export const estimate = userQuery(estimateAction);
export const estimateForAssistant = assistantQuery(estimateAction);
