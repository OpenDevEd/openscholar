/**
 * Plan-06 resume mutation, queue-runtime version.
 *
 * `resumeExtraction(jobId)` un-pauses both user-initiated pauses (`paused`)
 * and auto-pauses (`creditsExhausted`, plan 03). It:
 *
 *   1. Owns auth + ownership checks (same shape as pauseExtraction).
 *   2. When currentStatus is `creditsExhausted`, checks the balance covers
 *      the next paper's estimate, which is what each paper holds before it
 *      runs, and otherwise throws INSUFFICIENT_CREDITS.
 *   3. Calls `validateResumeTransition` (the pure decision helper) to
 *      reach the next status. On ok: patches the job (status flip +
 *      `runEpoch` bump) and re-dispatches paper queue work. On !ok with
 *      reason `not_paused`: returns silently — idempotent per plan 06
 *      § 'Idempotent mutations'.
 *
 * Queue resume contract:
 *
 *   - Bump `runEpoch` and clear pause fields.
 *   - If no papers exist yet, the job paused before setup expansion
 *     persisted papers; schedule the setup action for the new epoch.
 *   - Otherwise enqueue current non-terminal papers for the new epoch and
 *     dispatch the first queue window. Stale in-flight paper workers
 *     self-terminate at their next action boundary via the expectedEpoch
 *     mismatch.
 *
 *   Idempotency on re-dispatch: PDF indexing short-circuits via
 *   `existingPaper.isIndexed`, and a paper that's mid-extraction re-runs
 *   only the questions without a saved answer, then finalises.
 */

import { internalMutation, type MutationCtx } from "../../lib/functions";
import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { createError } from "../../lib/errors";
import { jobIn } from "../access";
import { readJobCounters } from "../jobCounters";
import { assistantMutation, defineUserMutation, reversedBy, userMutation } from "../../lib/userActions";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { validateResumeTransition } from "../../../lib/extraction/transitions";
import { extractionPaperCredits } from "../../../lib/pricing";
import { extractionPricing } from "../../ai/serverModel";
import { approvalLeft } from "../../billing/spend";
import {
  EXTRACTION_PAPER_CONCURRENCY,
  EXTRACTION_QUESTION_CONCURRENCY,
} from "../../../lib/extraction/limits";
import { MAX_QUESTIONS_PER_JOB } from "../validators";
import { capReached, spendingRoom } from "../../billing/memberCaps";

import { getFlag, requireFeature } from "../../featureFlags/guard";
import {
  dispatchPaperQueueWindowTx,
  enqueueInitialPapersForJobTx,
  enqueueRetryPapersForJobTx,
} from "../queue/mutations";

/** Papers one resume requeues in one transaction; a job with more requeues the rest in the pages it schedules. */
const REQUEUE_PAGE = 200;

type Requeue = { jobId: Id<"extractionJobs">; epoch: number; pdfEnabled: boolean; paperConcurrency: number; questionConcurrency: number; cursor: string | null; queued: number };

/**
 * Queues a page of a resumed job's unfinished papers for the new run: a paper queued for a
 * retry before the pause is queued for the same questions again, since a full run would redo
 * its answered and permanently failed questions. The last page starts the run, or finishes
 * the job when every paper had finished before the pause took effect.
 */
async function requeuePage(ctx: MutationCtx, run: Requeue) {
  const page = await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", run.jobId)).paginate({ cursor: run.cursor, numItems: REQUEUE_PAGE });
  const unfinished = page.page.filter((p) => p.status !== "completed" && p.status !== "failed" && p.status !== "download_failed" && p.status !== "indexing_failed").map((p) => p._id);
  const initialPaperIds: typeof unfinished = [];
  const retryPapers: Array<{ paperId: (typeof unfinished)[number]; questionKeys: string[] }> = [];
  for (const paperId of unfinished) {
    const lastQueued = await ctx.db
      .query("extractionPaperQueue")
      .withIndex("by_paper_and_epoch_and_kind", (q) => q.eq("paperId", paperId))
      .order("desc")
      .first();
    if (lastQueued?.kind === "retry" && lastQueued.questionKeys?.length) retryPapers.push({ paperId, questionKeys: lastQueued.questionKeys });
    else initialPaperIds.push(paperId);
  }
  await enqueueInitialPapersForJobTx(ctx, { jobId: run.jobId, paperIds: initialPaperIds, expectedEpoch: run.epoch, priority: 0 });
  await enqueueRetryPapersForJobTx(ctx, { jobId: run.jobId, retryPapers, expectedEpoch: run.epoch, priority: 0 });
  const queued = run.queued + unfinished.length;
  if (!page.isDone) return void (await ctx.scheduler.runAfter(0, internal.extraction.mutations.resume.requeueLater, { ...run, cursor: page.continueCursor, queued }));
  const job = await ctx.db.get("extractionJobs", run.jobId);
  if (queued === 0 && !(job?.setup && !job.setup.done)) {
    await ctx.scheduler.runAfter(0, internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId: run.jobId, expectedEpoch: run.epoch });
    return;
  }
  await dispatchPaperQueueWindowTx(ctx, {
    jobId: run.jobId,
    expectedEpoch: run.epoch,
    paperConcurrency: run.paperConcurrency,
    leaseOwner: `resume:${run.jobId}:${run.epoch}`,
    leaseMs: 60_000,
    questionConcurrency: run.questionConcurrency,
    pdfEnabled: run.pdfEnabled,
  });
}

/** Requeues the next page of a resumed job's papers, until none are left. */
export const requeueLater = internalMutation({
  args: { jobId: v.id("extractionJobs"), epoch: v.number(), pdfEnabled: v.boolean(), paperConcurrency: v.number(), questionConcurrency: v.number(), cursor: v.union(v.string(), v.null()), queued: v.number() },
  returns: v.null(),
  handler: async (ctx, run) => {
    // A run paused, cancelled or restarted since requeues nothing more.
    if (((await ctx.db.get("extractionJobs", run.jobId))?.runEpoch ?? 0) !== run.epoch) return null;
    await requeuePage(ctx, run);
    return null;
  },
});

/** The most carrying on a job costs: every paper it hasn't read yet, at the most one paper costs. */
async function resumeCredits(ctx: QueryCtx, job: Doc<"extractionJobs">) {
  const questions = await ctx.db.query("extractionQuestions").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(MAX_QUESTIONS_PER_JOB);
  const { processed } = await readJobCounters(ctx, job._id);
  return Math.max(0, (job.totalPapers ?? 0) - processed) * extractionPaperCredits(await extractionPricing(ctx, job), questions, job.usePdfs ?? false);
}

export const resumeExtractionAction = defineUserMutation({
  path: "extraction/mutations/resume:resumeExtraction",
  description:
    "Resumes one of the workspace's extractions that was paused or ran out of credits: it reads on from where it stopped, and spends credits on the papers it hasn't read. One that isn't paused is left as it is, and `reason` says why.",
  spendsCredits: true,
  outsideEffect: false,
  undoable: true,
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    resumed: v.boolean(),
    reason: v.optional(v.string()),
    undo: reversedBy("extraction/mutations/pause:pauseExtraction", { jobId: v.id("extractionJobs") }),
  }),
  estimate: async (ctx, actor, { jobId }) => resumeCredits(ctx, await jobIn(ctx, actor, jobId)),
  activity: ({ jobId }, { resumed }) => (resumed ? { kind: "extraction", id: jobId, happened: "resumed" } : null),
  run: async (ctx, actor, { jobId }): Promise<{ resumed: boolean; reason?: string; undo?: { path: "extraction/mutations/pause:pauseExtraction"; args: { jobId: Id<"extractionJobs"> } } }> => {
    const job = await jobIn(ctx, actor, jobId);
    await requireFeature(ctx, "extraction.enabled", actor.userId);

    if (!job.status) {
      return { resumed: false, reason: "not_paused" };
    }

    // Compute remaining estimate. For paused (user-initiated), the pure
    // decision helper ignores balance, so we only need real numbers when
    // currentStatus === "creditsExhausted".
    let availableCredits = 0;
    let capped = false;
    let remainingEstimateHigh = 0;

    if (job.status === "creditsExhausted") {
      // Its workspace pays for it (#650), within the cap of the member whose job it is.
      ({ available: availableCredits, capped } = await spendingRoom(ctx, job.workspaceId, job.createdBy));
      const questions = await ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .take(MAX_QUESTIONS_PER_JOB);
      // The next paper, on the models the job was stamped with.
      remainingEstimateHigh = extractionPaperCredits(await extractionPricing(ctx, job), questions, job.usePdfs ?? false);
    }

    const decision = validateResumeTransition({
      currentStatus: job.status as JobStatus,
      pausedFromStatus: job.pausedFromStatus as JobStatus | undefined,
      availableCredits,
      remainingEstimate: remainingEstimateHigh,
    });

    if (!decision.ok) {
      if (decision.reason === "insufficient_credits") {
        if (capped) throw capReached(decision.needed);
        throw createError(
          "INSUFFICIENT_CREDITS",
          `Resume needs ~${decision.needed} credits but only ${decision.available} available`,
        );
      }
      // "not_paused" — idempotent no-op.
      return { resumed: false, reason: decision.reason };
    }

    assertValidJobTransition(job.status as JobStatus, decision.nextStatus);
    const nextEpoch = (job.runEpoch ?? 0) + 1;
    await ctx.db.patch(jobId, {
      status: decision.nextStatus,
      runEpoch: nextEpoch,
      pausedAt: undefined,
      pausedFromStatus: undefined,
      // Clear any stale creditsExhausted error so the UI doesn't show it
      // after resume.
      error: undefined,
      ...(await approvalLeft(ctx, job)),
      updatedAt: Date.now(),
    });

    // Effective pdfEnabled = admin flag × per-job opt-in (mirrors
    // `getJobAndFlagsInternal`). Question concurrency mirrors the
    // queue setup action.
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfFlagOn = pdfFlag?.enabled ?? true;
    const pdfEnabled = pdfFlagOn && (job.usePdfs ?? false);

    const questionConcurrency = EXTRACTION_QUESTION_CONCURRENCY;
    const paperConcurrency = EXTRACTION_PAPER_CONCURRENCY;

    // A setup stopped partway reads on from where it was, and queues every paper when it ends:
    // a paper run before then could miss a screening copy still to come.
    // A job paused before any of its papers was saved, from before jobs kept their setup's place, sets up from the start.
    const unread = job.setup === undefined && (await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).first()) === null;
    if (unread) await ctx.db.patch(jobId, { setup: { position: 0, read: 0, papers: 0, processable: 0 } });
    if (unread || (job.setup !== undefined && !job.setup.done)) {
      await ctx.scheduler.runAfter(0, internal.extraction.actions.setupExtractionQueueJob, { jobId, expectedEpoch: nextEpoch });
    } else {
      await requeuePage(ctx, { jobId, epoch: nextEpoch, pdfEnabled, paperConcurrency, questionConcurrency, cursor: null, queued: 0 });
    }

    // A retry stopped while it reset the job's failures carries on where it stopped.
    if (job.retryReset && decision.nextStatus === "extracting") {
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.retry.resetRetryBatch, { jobId, epoch: nextEpoch });
    }

    return { resumed: true, undo: { path: "extraction/mutations/pause:pauseExtraction", args: { jobId } } };
  },
});
export const resumeExtraction = userMutation(resumeExtractionAction);
export const resumeExtractionForAssistant = assistantMutation(resumeExtractionAction);
