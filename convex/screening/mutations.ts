import { mutation, internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import { v, type Infer, type ObjectType } from "convex/values";
import { sourceMetadata } from "../../lib/library/paper-metadata";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  paperSetValidator,
  saveToValidator,
  screeningPaperInputValidator,
  screeningQuestionValidator,
  screeningScoringConfigValidator,
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
import { addCollectionMembership } from "../library/collectionMembership";
import { deriveCompletionTransition } from "./completion";
import { outcomeOf, scorePaper } from "./scoring";
import { decodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import { answeredFully, ensureScreening } from "../research/answers";
import { newCollection } from "../library/collections";
import { searchSnapshotValidator } from "../paperSets/openalex";
import { bookkeepLater } from "./bookkeeping";
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

/** What a job is made from, whoever makes it and whether or not its papers are read yet. */
const jobSetup = {
  /** Who started it: the search revision that takes on its questions records them. */
  author: v.union(v.literal("user"), v.literal("assistant")),
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
  // Missing: included papers are saved to the library alone, as jobs from before the screening page were.
  saveTo: v.optional(saveToValidator),
  prune: v.optional(v.boolean()),
  // The most it may spend, when the assistant starts it with the person's say (#328), and the hold that figure is kept in.
  spendCap: v.optional(v.number()),
  spendHold: v.optional(v.string()),
};
type JobSetup = ObjectType<typeof jobSetup>;

/**
 * Makes a job's row for `user`, with its progress row: finds the screening its answers go to,
 * names it after its set, and stamps it with the model Screen all runs on.
 */
async function insertJob(ctx: MutationCtx, user: Doc<"users">, { author, set, saveTo, prune, ...args }: JobSetup, state: Pick<Doc<"screeningJobs">, "status" | "totalPapers" | "reading" | "newCollection">) {
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

  // Stamped with what Screen All runs on (read back at run by screenPaperAction).
  const serverPick = await resolveTaskPick(ctx, user._id, "screenAll");
  const jobId = await ctx.db.insert("screeningJobs", {
    userId: user._id,
    ...state,
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
  return jobId;
}

/** Whether the person can pay for screening `papers` papers, with the figures a refusal names. */
async function affords(ctx: MutationCtx, userId: Id<"users">, papers: number) {
  const available = await availableCredits(ctx, userId);
  const estimate = estimateScreening(papers, available).credits;
  return { affordable: available >= estimate, estimate, available };
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
    papers: v.array(screeningPaperInputValidator),
    // How many of the papers the search's page already answers every question for
    // (`screening/queries:answeredCount`); the credit check leaves them out.
    answered: v.optional(v.number()),
    // The job that follows another in one request: it takes that job's place in the request
    // even when the person can no longer pay for it, so the page shows where the request stopped.
    chained: v.optional(v.boolean()),
    ...jobSetup,
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, { userId, papers, chained, answered = 0, ...setup }) => {
    // The acting user, who may have been suspended since the action began.
    const user = await requireActiveUser(ctx, userId);
    if (papers.length === 0) throw createError("VALIDATION_ERROR", "At least one paper is required");
    if (papers.length > MAX_SCREENING_PAPERS_PER_JOB) {
      throw createError("VALIDATION_ERROR", `Cannot screen more than ${MAX_SCREENING_PAPERS_PER_JOB} papers per job`);
    }
    // Papers the search's page already answered keep their answers and cost nothing. A job with a hold has its credits already: the balance is what the hold left.
    const { affordable, estimate, available } = setup.spendHold ? { affordable: true, estimate: 0, available: 0 } : await affords(ctx, user._id, papers.length - answered);
    if (!affordable && !chained) {
      throw createError("INSUFFICIENT_CREDITS", `Need ~${estimate} credits for ${papers.length} papers but only have ${available}`);
    }
    const jobId = await insertJob(ctx, user, setup, { status: affordable ? "processing" : "creditsExhausted", totalPapers: papers.length });
    const job = (await ctx.db.get("screeningJobs", jobId))!;
    if (affordable) await createResults(ctx, job, papers, job.createdAt);
    return { jobId };
  },
});

/**
 * How long a job may wait for its papers. An action runs for ten minutes at most, and one cut
 * short by the backend stopping records nothing: past this, the job never got its papers.
 */
const READ_LIMIT_MS = 15 * 60_000;

/**
 * Makes a job on a search before its papers are read, so the person has it at once: OpenAlex
 * can take seconds over them, or refuse them. `papers` is the most it may get. They follow
 * (`screening/start:read`), and the job is `reading` until they do.
 */
export const openScreeningJob = internalMutation({
  args: { userId: v.id("users"), papers: v.number(), ...jobSetup, first: v.number(), last: v.number(), snapshot: searchSnapshotValidator },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, { userId, papers, saveTo, ...setup }) => {
    const user = await requireActiveUser(ctx, userId);
    if (setup.set?.kind !== "search") throw createError("VALIDATION_ERROR", "Only a search's papers are read after its job is made");
    // A new collection is made with the papers, so a job that never gets any leaves none behind.
    const later = saveTo?.kind === "new" ? saveTo.name.trim() : undefined;
    if (later === "") throw createError("VALIDATION_ERROR", "Collection name cannot be empty");
    const jobId = await insertJob(ctx, user, { ...setup, ...(later ? {} : { saveTo }) }, { status: "processing", totalPapers: papers, reading: true, ...(later ? { newCollection: later } : {}) });
    const { set, first, last, through = last, questions, snapshot } = setup;
    await ctx.scheduler.runAfter(0, internal.screening.start.read, { jobId, userId, searchId: set.searchId, first, through, questions, snapshot });
    await ctx.scheduler.runAfter(READ_LIMIT_MS, internal.screening.mutations.failScreeningRead, { jobId, reason: "Its papers took too long to read. Run it again." });
    return { jobId };
  },
});

/**
 * Gives a job made by `openScreeningJob` its papers, and the part of its request they turned
 * out to be. The person's credits are checked as for a job made with its papers; one they
 * can't pay for stays, out of credits. A job cancelled while its papers were read is left alone.
 */
export const fillScreeningJob = internalMutation({
  args: {
    jobId: v.id("screeningJobs"),
    papers: v.array(screeningPaperInputValidator),
    first: v.number(),
    last: v.number(),
    through: v.optional(v.number()),
    resume: v.optional(v.string()),
    answered: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, papers, answered, first, last, through, resume }) => {
    const reading = await ctx.db.get("screeningJobs", jobId);
    if (!reading?.reading || reading.status !== "processing") return null;
    // The person may have been suspended while the papers were read.
    await requireActiveUser(ctx, reading.userId);
    const affordable = reading.spendHold !== undefined || (await affords(ctx, reading.userId, papers.length - answered)).affordable;
    const now = Date.now();
    const made = affordable && reading.newCollection ? { targetCollectionId: await newCollection(ctx, reading.userId, reading.newCollection), newCollection: undefined } : {};
    await ctx.db.patch("screeningJobs", jobId, { reading: undefined, totalPapers: papers.length, first, last, through, resume, updatedAt: now, ...made, ...(affordable ? {} : { status: "creditsExhausted" as const }) });
    if (affordable) await createResults(ctx, (await ctx.db.get("screeningJobs", jobId))!, papers, now);
    return null;
  },
});

/** How much of why a job couldn't get its papers is kept. */
const FAILURE_SHOWN = 600;

/** Ends a job that couldn't get its papers as failed, with why. A job cancelled meanwhile is left alone. */
export const failScreeningRead = internalMutation({
  args: { jobId: v.id("screeningJobs"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId, reason }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job?.reading || job.status !== "processing") return null;
    await ctx.db.patch("screeningJobs", jobId, { status: "failed", reading: undefined, failure: reason.slice(0, FAILURE_SHOWN), updatedAt: Date.now() });
    return null;
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
  const screening = (await ctx.db.get("screenings", job.screeningId))!;
  const reused = job.set?.kind === "search" ? await answeredFully(ctx, screening, job.questions.map((q) => q.question), batch.map((paper) => paper.openalexId)) : new Set<string>();
  for (const paper of batch) {
    const done = reused.has(paper.openalexId);
    await ctx.db.insert("screeningResults", {
      ...sourceMetadata(paper),
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
        : job.capped
          ? // The job reached the most it may spend while its papers were still being made: the rest are never read.
            { status: "skipped" as const, completedAt: createdAt, doneAt: ctx.db.vars.commitTs }
          : { status: "processing" as const, waitingUser: job.userId, waitingSince: createdAt }),
    });
  }
  if (reused.size) await ctx.db.patch("screeningJobs", job._id, { reused: (job.reused ?? 0) + reused.size });
  if (reused.size || job.capped) await bookkeepLater(ctx);
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
    const screeningId = await ctx.db.insert("screenings", { userId: args.userId, version: 0, createdAt: now });
    const jobId = await ctx.db.insert("screeningJobs", { ...args, screeningId, status: "failed", totalPapers: args.last - args.first + 1, createdAt: now, updatedAt: now });
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
 * work cancelled. With `waitingOnly`, for a job that reached the most it may spend, the
 * started ones are left to finish.
 */
export const endScreeningWork = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()), waitingOnly: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor, waitingOnly }) => {
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
    if (!waitingOnly) {
      for (const workId of getCancelableScreeningWorkIds(page.page)) {
        await screeningPool.cancel(ctx, workId);
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.screening.mutations.endScreeningWork, { jobId, cursor: page.continueCursor, ...(waitingOnly ? { waitingOnly } : {}) });
    }
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS (for workpool/background context)
// ═══════════════════════════════════════════════════════════════

/**
 * A job has spent what it may (#328): no more of its papers start. Unlike a job that is
 * cancelled or out of credits, it goes on running until the papers the model is already
 * reading are done, since they are paid for and their answers are kept. It then ends as
 * one that stopped at its limit (./bookkeeping.ts). No-op when it's capped already, or ended.
 */
export const capScreeningJob = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.capped || job.status !== "processing") return null;
    await ctx.db.patch("screeningJobs", jobId, { capped: true, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.screening.mutations.endScreeningWork, { jobId, cursor: null, waitingOnly: true });
    return null;
  },
});

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
    // A paper that came up after its job had spent what it may wasn't read (./workpoolActions.ts): it is skipped, as one cancelled is.
    const notRead = result.kind === "success" && (result.returnValue as { capped?: boolean }).capped === true;
    if (result.kind === "success" && job.status === "processing" && !notRead) {
      const data = result.returnValue as {
        model?: string;
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
          aiMetadata: { confidence: data.confidence, ...(data.model ? { model: data.model } : {}) },
          ...(data.credits === undefined ? {} : { creditsUsed: data.credits }),
        },
      });
    } else {
      transition = deriveCompletionTransition({
        currentRowStatus: screeningResult.status,
        jobStatus: job.status,
        resultKind: notRead ? "canceled" : result.kind === "success" ? "success" : result.kind === "canceled" ? "canceled" : "failure",
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
