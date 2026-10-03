import { mutation, internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  paperSetValidator,
  saveToValidator,
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
import { outcomeOf, scorePaper } from "./scoring";
import { decodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import { answeredFully, ensureScreening } from "../research/answers";
import { newCollection } from "../library/collections";
import { searchSnapshotValidator } from "../paperSets/openalex";
import { bookkeepLater, ensureProgress, saveQualified } from "./bookkeeping";
import { startWaitingPapers } from "./slots";
import { estimateScreening } from "./estimate";
import { applyCommand } from "../research/records";

import { availableCredits } from "../billing/accounts";
import { MAX_AUTHORS } from "../lib/listCaps";

/** Where the job's included papers go, as its fields: a collection, or nowhere. */
async function destination(ctx: MutationCtx, userId: Id<"users">, saveTo: Infer<typeof saveToValidator> | undefined) {
  if (!saveTo) return {};
  if (saveTo.kind === "none") return { unsaved: true as const };
  if (saveTo.kind === "new") return { targetCollectionId: await newCollection(ctx, userId, saveTo.name) };
  if ((await ctx.db.get("collections", saveTo.collectionId))?.userId !== userId) throw createError("NOT_FOUND", "Collection not found");
  return { targetCollectionId: saveTo.collectionId };
}

/**
 * Creates a Screen all job for `userId` from papers the server has already resolved
 * (`screening/start:screen`); the browser never sends papers. Checks the person's credits,
 * stamps the job with the model Screen all runs on, creates a result for each paper a batch
 * a transaction, and starts as many as the person has slots free. A person may run any
 * number of jobs: their papers take turns under their plan's limit (./slots.ts).
 */
export const createScreeningJobForUser = internalMutation({
  args: {
    userId: v.id("users"),
    /** Who started it: the search revision that takes on its questions records them. */
    author: v.union(v.literal("user"), v.literal("assistant")),
    papers: v.array(screeningPaperInputValidator),
    questions: v.array(screeningQuestionValidator),
    scoringConfig: screeningScoringConfigValidator,
    // Where the papers came from, which of them these are (from 1), and the last paper of
    // the whole request when it's more than this job holds. A search's page shows the answers.
    set: v.optional(paperSetValidator),
    first: v.optional(v.number()),
    last: v.optional(v.number()),
    through: v.optional(v.number()),
    resume: v.optional(v.string()),
    snapshot: v.optional(searchSnapshotValidator),
    // How many of the papers the search's page already answers every question for
    // (`screening/queries:answeredCount`); the credit check leaves them out.
    answered: v.optional(v.number()),
    // Missing: included papers are saved to the library alone, as jobs from before the screening page were.
    saveTo: v.optional(saveToValidator),
    prune: v.optional(v.boolean()),
    // The job that follows another in one request: it takes that job's place in the request
    // even when the person can no longer pay for it, so the page shows where the request stopped.
    chained: v.optional(v.boolean()),
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, { userId, author, papers, set, saveTo, prune, chained, answered = 0, ...args }) => {
    // The acting user, who may have been suspended since the action began.
    const user = await requireActiveUser(ctx, userId);
    if (papers.length === 0) throw createError("VALIDATION_ERROR", "At least one paper is required");
    if (papers.length > MAX_SCREENING_PAPERS_PER_JOB) {
      throw createError("VALIDATION_ERROR", `Cannot screen more than ${MAX_SCREENING_PAPERS_PER_JOB} papers per job`);
    }
    if (prune && set?.kind !== "collection") throw createError("VALIDATION_ERROR", "Only a collection's papers can leave it");

    // The screening its answers go to, and the set's name as the page shows it.
    const now = Date.now();
    let screeningId: Id<"screenings">;
    let label: string | undefined;
    if (set?.kind === "search") {
      const localId = set.searchId;
      const search = await ctx.db.query("searches").withIndex("by_user_and_localId", (q) => q.eq("userId", user._id).eq("localId", localId)).unique();
      if (!search) throw createError("NOT_FOUND", "Search not found");
      // The search's page shows answers to its own questions, so it takes on the job's it
      // lacks, all in one edit with one revision.
      const asked = new Set(search.data.screeningQuestions.map(({ question }) => question));
      const missing = [...new Set(args.questions.map((q) => q.question))].filter((question) => !asked.has(question));
      if (missing.length) {
        const screeningQuestions = [...search.data.screeningQuestions, ...missing.map((question) => ({ question }))];
        await applyCommand(ctx, user._id, { kind: "editSearch", id: localId, edit: { kind: "patch", fields: { screeningQuestions }, clear: [] } }, author);
      }
      screeningId = (await ensureScreening(ctx, user._id, search._id))._id;
      label = search.data.query;
    } else {
      screeningId = await ctx.db.insert("screenings", { userId: user._id, version: 0, createdAt: now });
      const source = set?.kind === "collection" ? await ctx.db.get("collections", set.collectionId) : set?.kind === "screening" ? await ctx.db.get("screeningJobs", set.jobId) : null;
      if (set && set.kind !== "saved" && source?.userId !== user._id) throw createError("NOT_FOUND", set.kind === "collection" ? "Collection not found" : "Screening not found");
      label = source ? ("name" in source ? source.name : source.label) : undefined;
    }

    // Papers the search's page already answered keep their answers and cost nothing.
    const available = await availableCredits(ctx, user._id);
    const estimate = estimateScreening(papers.length - answered, available).credits;
    const affordable = available >= estimate;
    if (!affordable && !chained) {
      throw createError("INSUFFICIENT_CREDITS", `Need ~${estimate} credits for ${papers.length} papers but only have ${available}`);
    }

    // Stamped with what Screen All runs on (read back at run by screenPaperAction).
    const serverPick = await resolveTaskPick(ctx, user._id, "screenAll");
    const jobId = await ctx.db.insert("screeningJobs", {
      userId: user._id,
      status: affordable ? "processing" : "creditsExhausted",
      totalPapers: papers.length,
      screeningId,
      ...args,
      ...(set ? { set } : {}),
      ...(label ? { label } : {}),
      ...(await destination(ctx, user._id, saveTo)),
      ...(prune ? { prune: true as const } : {}),
      ...serverStamp(serverPick),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0 });
    if (affordable) await createResults(ctx, (await ctx.db.get("screeningJobs", jobId))!, papers, now);
    return { jobId };
  },
});

/** Papers whose results one transaction creates: about six index reads each, well inside 4,096. */
const CREATE_BATCH = 250;
type PaperInput = Infer<typeof screeningPaperInputValidator>;

/**
 * Creates a batch of a job's results, waiting for their person's paper slots, starts as many
 * as the person has free, then schedules the next batch. A paper of a search's that its page
 * already answered every question for is done at once on those answers, takes no slot and
 * costs nothing: the bookkeeping worker scores and counts it.
 */
async function createResults(ctx: MutationCtx, job: Doc<"screeningJobs">, papers: PaperInput[], createdAt: number) {
  const batch = papers.slice(0, CREATE_BATCH);
  const screening = (await ctx.db.get("screenings", job.screeningId!))!;
  const reused = job.set?.kind === "search" ? await answeredFully(ctx, screening, job.questions.map((q) => q.question), batch.map((paper) => paper.openalexId)) : new Set<string>();
  for (const paper of batch) {
    const done = reused.has(paper.openalexId);
    await ctx.db.insert("screeningResults", {
      jobId: job._id,
      openalexId: paper.openalexId,
      title: paper.title,
      abstract: paper.abstract,
      authors: paper.authors?.slice(0, MAX_AUTHORS),
      publicationYear: paper.publicationYear,
      doi: paper.doi,
      venue: paper.venue,
      citedByCount: paper.citedByCount,
      createdAt,
      ...(done
        ? { status: "completed" as const, completedAt: createdAt, answersVersion: screening.version, doneAt: ctx.db.vars.commitTs }
        : { status: "processing" as const, waitingUser: job.userId, waitingSince: createdAt }),
    });
  }
  if (reused.size) {
    await ctx.db.patch("screeningJobs", job._id, { reused: (job.reused ?? 0) + reused.size });
    await bookkeepLater(ctx);
  }
  await startWaitingPapers(ctx, job.userId);
  if (papers.length > CREATE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.screening.mutations.createScreeningResults, { jobId: job._id, papers: papers.slice(CREATE_BATCH), createdAt });
  }
}

/**
 * Records where a request stopped when its next job couldn't start: a failed job in its
 * place, with no papers.
 */
export const stopRequest = internalMutation({
  args: {
    userId: v.id("users"),
    set: paperSetValidator,
    first: v.number(),
    last: v.number(),
    through: v.optional(v.number()),
    label: v.optional(v.string()),
    questions: v.array(screeningQuestionValidator),
    scoringConfig: screeningScoringConfigValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("screeningJobs", { ...args, status: "failed", totalPapers: args.last - args.first + 1, createdAt: now, updatedAt: now });
    await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0 });
    return null;
  },
});

/** The next batch of a job's results, unless the job was cancelled or ended meanwhile. */
export const createScreeningResults = internalMutation({
  args: { jobId: v.id("screeningJobs"), papers: v.array(screeningPaperInputValidator), createdAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, papers, createdAt }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (job?.status !== "processing") return null;
    await createResults(ctx, job, papers, createdAt);
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
    // Its papers' queued work is dropped in batches afterwards, as Firecrawl drops a cancelled
    // crawl's queue, so the pool's slots free up sooner.
    await ctx.scheduler.runAfter(0, internal.screening.mutations.endScreeningWork, { jobId: args.jobId, cursor: null });

    return null;
  },
});

/** Results one batch of an ended job's sweep handles. */
const END_BATCH = 100;

/**
 * Ends a job's remaining papers once it was cancelled or ran out of credits, a batch at a
 * time: those still waiting for a slot are skipped, and those started have their queued
 * work cancelled.
 */
export const endScreeningWork = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor }) => {
    const page = await ctx.db
      .query("screeningResults")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .paginate({ cursor, numItems: END_BATCH });
    let skipped = 0;
    for (const result of page.page) {
      if (result.waitingSince === undefined) continue;
      // Never started: counted as skipped by the bookkeeping worker.
      await ctx.db.patch("screeningResults", result._id, { status: "skipped", waitingUser: undefined, waitingSince: undefined, completedAt: Date.now(), doneAt: ctx.db.vars.commitTs });
      skipped++;
    }
    if (skipped) await bookkeepLater(ctx);
    for (const workId of getCancelableScreeningWorkIds(page.page)) {
      await screeningPool.cancel(ctx, workId);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.screening.mutations.endScreeningWork, { jobId, cursor: page.continueCursor });
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
    await ctx.scheduler.runAfter(0, internal.screening.mutations.endScreeningWork, { jobId: args.jobId, cursor: null });
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
        // What the paper cost; missing from results returned before a job kept its spending.
        credits?: number;
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
      const outcome = outcomeOf(answers, job.scoringConfig);
      transition = deriveCompletionTransition({
        currentRowStatus: screeningResult.status,
        jobStatus: job.status,
        resultKind: "success",
        completedRowDetails: {
          score,
          stars,
          qualified,
          outcome,
          aiMetadata: { confidence: data.confidence },
          ...(data.credits === undefined ? {} : { creditsUsed: data.credits }),
        },
      });
    } else {
      transition = deriveCompletionTransition({
        currentRowStatus: screeningResult.status,
        jobStatus: job.status,
        resultKind: result.kind === "success" ? "success" : result.kind === "canceled" ? "canceled" : "failure",
      });
    }
    // A paper the model answered after its job ended still cost what it cost.
    const spent = result.kind === "success" ? (result.returnValue as { credits?: number }).credits : undefined;

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
        ...(spent === undefined ? {} : { creditsUsed: spent }),
        ...(result.kind === "failed" ? { errorMessage: result.error } : {}),
      });
    }
    await bookkeepLater(ctx);
  },
});
