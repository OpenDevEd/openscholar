import { mutation, internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  screeningPaperInputValidator,
  screeningQuestionValidator,
  screeningScoringConfigValidator,
  screeningJobStatusValidator,
} from "./validators";
import { requireActiveUser, requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { resolveTaskPick, serverStamp } from "../ai/serverModel";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { screeningPool } from "../workpool";
import {
  getCancelableScreeningWorkIds,
  isTerminalScreeningJobStatus,
} from "./lifecycle";
import { upsertLibraryItem } from "../library/mutations";
import { addCollectionMembership } from "../library/collectionMembership";
import { deriveCompletionTransition } from "./completion";
import { scorePaper } from "./scoring";
import { decodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import { ensureScreening } from "../research/answers";
import { bookkeepLater, ensureProgress, saveQualified } from "./bookkeeping";
import { estimateScreening } from "./estimate";
import { applyCommand, moveSearchAnswers } from "../research/records";

import { availableCredits } from "../billing/accounts";

/**
 * Create a bulk screening job.
 *
 * Validates paper count, checks credits, guards against concurrent active jobs,
 * creates the job record with embedded questions/scoring config, inserts
 * processing result records for each paper, and enqueues each paper directly
 * into the screening workpool.
 */
/**
 * Creates a Screen all job for `userId` from papers the server has already resolved
 * (`screening/start:screenSearch`); the browser never sends papers.
 */
export const createScreeningJobForUser = internalMutation({
  args: {
    userId: v.id("users"),
    papers: v.array(screeningPaperInputValidator),
    questions: v.array(screeningQuestionValidator),
    scoringConfig: screeningScoringConfigValidator,
    targetCollectionId: v.optional(v.id("collections")),
    // The saved search screened, by its ID in the browser; its page shows the answers.
    searchId: v.optional(v.string()),
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, { userId, ...args }) => {
    // 1. The acting user, who may have been suspended since the action began
    const user = await requireActiveUser(ctx, userId);

    // 2. Validate paper count
    if (args.papers.length === 0) {
      throw createError(
        "VALIDATION_ERROR",
        "At least one paper is required"
      );
    }
    if (args.papers.length > MAX_SCREENING_PAPERS_PER_JOB) {
      throw createError(
        "VALIDATION_ERROR",
        `Cannot screen more than ${MAX_SCREENING_PAPERS_PER_JOB} papers per job`
      );
    }

    // 3. Check for active jobs
    const activeJob = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "processing")
      )
      .first();

    if (activeJob) {
      throw createError(
        "SCREENING_JOB_ALREADY_ACTIVE",
        "You already have an active screening job"
      );
    }

    // 4. Credit pre-flight check
    const totalAvailable = await availableCredits(ctx, user._id);

    const estimatedCost = estimateScreening(args.papers.length, totalAvailable).credits;
    if (totalAvailable < estimatedCost) {
      throw createError(
        "INSUFFICIENT_CREDITS",
        `Need ~${estimatedCost} credits for ${args.papers.length} papers but only have ${totalAvailable}`
      );
    }

    // 5. Create screening job record, stamped with what Screen All runs on (read
    // back at run by screenPaperAction).
    const serverPick = await resolveTaskPick(ctx, user._id, "screenAll");
    const now = Date.now();
    let screeningId: Id<"screenings">;
    if (args.searchId) {
      const localId = args.searchId;
      const search = await ctx.db.query("searches").withIndex("by_user_and_localId", (q) => q.eq("userId", user._id).eq("localId", localId)).unique();
      if (!search) throw createError("NOT_FOUND", "Search not found");
      // A search still holding answers in chunks moves them before it has a screening.
      await moveSearchAnswers(ctx, search._id, user._id);
      // The search's page shows answers to its own questions, so it takes on the job's it
      // lacks, all in one edit with one revision.
      const asked = new Set(search.data.screeningQuestions.map(({ question }) => question));
      const missing = [...new Set(args.questions.map((q) => q.question))].filter((question) => !asked.has(question));
      if (missing.length) {
        const screeningQuestions = [...search.data.screeningQuestions, ...missing.map((question) => ({ question }))];
        await applyCommand(ctx, user._id, { kind: "editSearch", id: localId, edit: { kind: "patch", fields: { screeningQuestions }, clear: [] } }, "user");
      }
      screeningId = (await ensureScreening(ctx, user._id, search._id))._id;
    } else {
      screeningId = await ctx.db.insert("screenings", { userId: user._id, version: 0, createdAt: now });
    }
    const jobId = await ctx.db.insert("screeningJobs", {
      userId: user._id,
      status: "processing",
      totalPapers: args.papers.length,
      questions: args.questions,
      scoringConfig: args.scoringConfig,
      targetCollectionId: args.targetCollectionId,
      screeningId,
      ...serverStamp(serverPick),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0 });

    // 6. Insert processing result records and enqueue their work items: the first batch here,
    // the rest a batch per transaction after.
    await createResults(ctx, jobId, args.papers, now);

    // 7. Return job ID
    return { jobId };
  },
});

/** Papers whose results one transaction creates: about six index reads each, well inside 4,096. */
const CREATE_BATCH = 250;
type PaperInput = Infer<typeof screeningPaperInputValidator>;

/** Creates a batch of a job's results and enqueues their work, then schedules the next batch. */
async function createResults(ctx: MutationCtx, jobId: Id<"screeningJobs">, papers: PaperInput[], createdAt: number) {
  for (const paper of papers.slice(0, CREATE_BATCH)) {
    const resultId = await ctx.db.insert("screeningResults", {
      jobId,
      openalexId: paper.openalexId,
      title: paper.title,
      abstract: paper.abstract,
      authors: paper.authors,
      publicationYear: paper.publicationYear,
      doi: paper.doi,
      status: "processing",
      createdAt,
    });
    const workId = await screeningPool.enqueueAction(
      ctx,
      internal.screening.workpoolActions.screenPaperAction,
      { resultId, jobId },
      { onComplete: internal.screening.mutations.handleScreeningComplete, context: { resultId, jobId } },
    );
    await ctx.db.patch("screeningResults", resultId, { workId });
  }
  if (papers.length > CREATE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.screening.mutations.createScreeningResults, { jobId, papers: papers.slice(CREATE_BATCH), createdAt });
  }
}

/** The next batch of a job's results, unless the job was cancelled or ended meanwhile. */
export const createScreeningResults = internalMutation({
  args: { jobId: v.id("screeningJobs"), papers: v.array(screeningPaperInputValidator), createdAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, papers, createdAt }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (job?.status !== "processing") return null;
    await createResults(ctx, jobId, papers, createdAt);
    return null;
  },
});

/**
 * Cancel a running screening job.
 *
 * - Sets status to "cancelled" for non-terminal jobs
 * - Idempotent: terminal statuses (completed, cancelled, failed, creditsExhausted)
 *   are no-ops (no error, no state change)
 * - Preserves existing screening results
 * - Cancels only this job's outstanding workpool items
 */
export const cancelScreeningJob = mutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get("screeningJobs", args.jobId);

    if (!job || job.userId !== user._id) {
      throw createError("SCREENING_JOB_NOT_FOUND", "Screening job not found");
    }

    // Terminal states are idempotent no-ops
    if (isTerminalScreeningJobStatus(job.status)) {
      return null;
    }

    // One write: papers check the job before they run and skip a cancelled one, so
    // cancelling never waits on, or conflicts with, the papers finishing meanwhile.
    await ctx.db.patch("screeningJobs", args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    // Their queued work is dropped in batches afterwards, as Firecrawl drops a cancelled
    // crawl's queue, so the pool's slots free up sooner.
    await ctx.scheduler.runAfter(0, internal.screening.mutations.cancelScreeningWork, { jobId: args.jobId, cursor: null });

    return null;
  },
});

/** Results whose queued work one batch cancels. */
const CANCEL_BATCH = 100;

/** Cancels a cancelled job's queued paper work, a batch at a time. */
export const cancelScreeningWork = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor }) => {
    const page = await ctx.db
      .query("screeningResults")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .paginate({ cursor, numItems: CANCEL_BATCH });
    for (const workId of getCancelableScreeningWorkIds(page.page)) {
      await screeningPool.cancel(ctx, workId);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.screening.mutations.cancelScreeningWork, { jobId, cursor: page.continueCursor });
    }
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS (for workpool/background context)
// ═══════════════════════════════════════════════════════════════

/**
 * Marks a screening job as credits exhausted from background context.
 *
 * No-op when the job is already terminal or missing.
 */
export const markScreeningJobCreditsExhausted = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || isTerminalScreeningJobStatus(job.status)) {
      return null;
    }

    await ctx.db.patch("screeningJobs", args.jobId, {
      status: "creditsExhausted",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Add a library item to a collection (no auth, internal only).
 *
 * Idempotent: if already in collection, no-op.
 * Increments denormalized itemCount on the collection.
 */
export const addToCollectionInternal = internalMutation({
  args: {
    userId: v.id("users"),
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const collection = await ctx.db.get("collections", args.collectionId);
    if (collection) {
      await addCollectionMembership(ctx, {
        userId: args.userId,
        collection,
        libraryItemId: args.libraryItemId,
      });
    }
    return null;
  },
});

/**
 * Saves a qualified paper scheduled before its job's bookkeeping moved to the worker
 * (./bookkeeping.ts). Remove once no deployment has such a call pending.
 */
export const persistQualifiedScreeningResult = internalMutation({
  args: { resultId: v.id("screeningResults") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await ctx.db.get("screeningResults", args.resultId);
    if (!result || result.status !== "completed" || result.qualified !== true || result.libraryItemId) return null;
    const job = await ctx.db.get("screeningJobs", result.jobId);
    if (job) await saveQualified(ctx, job, result);
    return null;
  },
});

/**
 * Finishes a job, scheduled before its bookkeeping moved to the worker (./bookkeeping.ts),
 * which finishes jobs now. Remove once no deployment has such a call pending.
 */
export const finalizeScreeningJobFromAggregates = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureProgress(ctx, args.jobId);
    return null;
  },
});

/**
 * Workpool onComplete handler for individual paper screening.
 *
 * Patches only the target screening result row, records aggregate state, and
 * schedules any secondary work as follow-up mutations.
 */
export const handleScreeningComplete = screeningPool.defineOnComplete({
  context: v.object({
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    const job = await ctx.db.get("screeningJobs", context.jobId) as
      | Doc<"screeningJobs">
      | null;
    const screeningResult = await ctx.db.get(
      "screeningResults",
      context.resultId,
    ) as Doc<"screeningResults"> | null;
    if (!job || !screeningResult) {
      return;
    }

    let transition;
    let pending: { answers: Record<string, boolean | null>; confidences: Record<string, number> } | null = null;
    if (result.kind === "success" && job.status === "processing") {
      const data = result.returnValue as {
        responses: Record<string, boolean | null>;
        // Missing from results returned before #334.
        confidences?: Record<string, number>;
        confidence: number;
      };
      const decodedResponses = decodeQuestionResponseMap(data.responses);
      const decodedConfidences = decodeQuestionResponseMap(data.confidences ?? {});
      const answers: Record<string, boolean | null> = {};
      for (const q of job.questions) {
        const response = decodedResponses[q.question];
        answers[q.key] = response ?? null;
      }
      pending = {
        answers,
        confidences: Object.fromEntries(job.questions.flatMap((q) => (decodedConfidences[q.question] === undefined ? [] : [[q.key, decodedConfidences[q.question]]]))),
      };

      const { score, stars, qualified } = scorePaper(answers, job.scoringConfig);
      transition = deriveCompletionTransition({
        currentRowStatus: screeningResult.status,
        jobStatus: job.status,
        resultKind: "success",
        completedRowDetails: {
          score,
          stars,
          qualified,
          aiMetadata: { confidence: data.confidence },
        },
      });
    } else {
      transition = deriveCompletionTransition({
        currentRowStatus: screeningResult.status,
        jobStatus: job.status,
        resultKind: result.kind === "success" ? "success" : "failure",
      });
    }

    if (transition.kind === "noop") {
      return;
    }

    // The paper writes only its own row; stamped `doneAt`, it joins the bookkeeping queue,
    // whose one worker counts it, moves its answers, saves it if it qualified, and finishes
    // the job (./bookkeeping.ts).
    const completedAt = Date.now();
    const doneAt = ctx.db.vars.commitTs;
    if (transition.rowPatch.status === "completed") {
      await ctx.db.patch("screeningResults", context.resultId, {
        ...transition.rowPatch,
        completedAt,
        doneAt,
        ...(pending ? { ...pending, pendingAnswers: true as const } : {}),
      });
    } else {
      await ctx.db.patch("screeningResults", context.resultId, {
        ...transition.rowPatch,
        completedAt,
        doneAt,
        ...(result.kind === "failed"
          ? { errorMessage: result.error }
          : result.kind === "canceled"
            ? { errorMessage: "workpool_canceled" }
            : {}),
      });
    }
    await bookkeepLater(ctx);
  },
});
