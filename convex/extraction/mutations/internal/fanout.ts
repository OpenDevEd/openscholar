/**
 * Tier E.1 — paper-workflow fan-out.
 *
 * The setup workflow (`runExtractionWorkflow` / `runRetryWorkflow`) no
 * longer awaits its per-paper children via `step.runWorkflow`. Awaiting
 * 50 child workflows on a single parent forced every child's
 * `nestedWorkflowOnComplete` to read+patch the parent's `workflows` row,
 * insert a `steps` row on the parent, and re-enqueue the parent in
 * `pendingStart` / `pendingCompletion` — four hot tables, all keyed by
 * the parent's workflowId, contended by 50 concurrent writers per job.
 *
 * Instead, the setup workflow calls `step.runMutation(<this file>)`,
 * which launches each paper workflow as a ROOT workflow via
 * `workflow.start(..., { startAsync: true })`. The paper workflows have
 * no parent tether; they own their own `workflows` row, their own
 * `steps` table, and report progress through the sharded `jobCounters`
 * → `maybeFinalizeJob` path that already exists.
 *
 * `startAsync: true` defers the workflow's first step to the workflow
 * component's background tick, so the launch mutation itself doesn't
 * have to inline-schedule 50 immediate function calls inside its tx.
 *
 * Pause / resume after detach:
 *   - When `extractOneQuestion` or `downloadAndIndexPdfAction` returns
 *     `skipped:paused`/`credits_exhausted`/`stale_epoch`, the paper
 *     workflow exits via `classifyWorkerSkip → "park"`. No awaitEvent —
 *     parking a root workflow with `step.awaitEvent` would require a
 *     fan-out `sendEvent` per paper, but the workflow component's
 *     event channel is 1:1 (single producer → single consumer).
 *   - `resumeExtraction` re-launches a fresh paper workflow for every
 *     non-terminal paper after bumping `runEpoch`. Any stale in-flight
 *     workflow self-terminates at its next step via the
 *     `getWorkerSkipReason` epoch check, dropping to `stale_epoch`.
 *
 * Cancel after detach:
 *   - `cancelExtraction` patches `job.status = "cancelled"` and calls
 *     `workflow.cancel(setupWorkflowId)`. The per-paper workflows are
 *     NOT individually cancelled — each one's next action call sees
 *     `job.status === "cancelled"` via `getWorkerSkipReason` and exits
 *     cleanly via the `cancelled → "halted"` path. The cost is one
 *     extra action call per paper (the one that detects cancellation);
 *     the benefit is no O(P) workflow.cancel round-trip in the cancel
 *     mutation, which would itself OCC-contend on the workflows table.
 *
 * Credit reservation (this mutation's second job):
 *
 *   Before reservations, `finalizePaper` deducted credits inline from
 *   the user's wallet at terminal-transition time. With the OCC-contended
 *   `credits.{free,paid}` row replaced by the append-only ledger plus
 *   sharded balance counters, those parallel deducts no longer serialize
 *   on a shared cell — each settle inserts its own ledger row and shards
 *   its balance delta across 16 counter rows per pool. Concurrent
 *   finalizers race past their own `readBalance` reads, each "see" the
 *   full wallet, and each commit a debit. The wallet then settles to a
 *   negative balance equal to (concurrent debits × per-paper cost) −
 *   (actual wallet).
 *
 *   Fix: convert the inline debit into a HELD reservation that's placed
 *   at fan-out time and SETTLED at finalize time. Reservations are
 *   negative-amount ledger rows that lower the visible balance the
 *   moment they're inserted, so the next concurrent reserver against
 *   the same wallet sees the already-held amount and either fits or
 *   fails the pre-flight cleanly. The settle phase replaces the hold
 *   with a real usage row charged against the actuals — overshoot the
 *   estimate by a little, the user pays the actuals; undershoot, the
 *   excess hold is released back to the wallet.
 *
 *   Per-paper budget:
 *     budget = questionCount × (pdfEnabled
 *       ? PDF_Q_CREDIT_HIGH
 *       : ABSTRACT_Q_CREDIT_HIGH)
 *
 *   The HIGH side of the estimator is intentional — better to over-
 *   reserve and settle down than to under-reserve and need a second
 *   mid-fanout debit attempt. Indexing (`INDEX_PDF_CREDIT = 1.5`) stays
 *   live in `markPaperIndexed` because there's no per-paper concurrency
 *   storm on the indexing path — each paper indexes at most once and
 *   the live deduct is gated behind `indexingBilled`.
 *
 *   Idempotency:
 *     - Re-launch (resume): a paper that already carries `reservationId`
 *       is skipped by the reserve-loop. The release path is also
 *       idempotent — `releaseReservationTransaction` probes for an
 *       existing `reservation_release` row before inserting an offset.
 *     - Resume on a billed paper: `paper.questionsBilled === true` means
 *       the paper finalized in a prior epoch; settle already cleared the
 *       hold. Resume filters terminal papers out via `paper.status`, so
 *       a billed paper never reaches this mutation.
 *
 *   Pre-flight (insufficient credits):
 *     - We sum the budgets of every paper that needs a fresh reservation
 *       and compare against `readBalance(...).total`. If insufficient,
 *       patch `job.status = "creditsExhausted"` with a structured error
 *       and return without launching anything. The setup workflow exits
 *       quietly; the user resumes after topping up via the existing
 *       `resumeExtraction` path.
 *
 *   Retry path:
 *     - Retries DO NOT reserve. The retry mutation resets
 *       `result.status = "pending"` for the retryable questions but
 *       leaves `paper.questionsBilled === true` intact, and
 *       `finalizePaper` short-circuits its debit branch on that flag —
 *       retries reuse the originally-billed credits, so there's nothing
 *       to reserve. Clearing `questionsBilled` to re-bill would double-
 *       charge the already-completed questions. Documented inline at
 *       `launchRetryPaperWorkflowsForJob`.
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { workflow } from "../../../workflow";
import { reserveCreditsTransaction } from "../../../credits/reservation";
import { readBalance } from "../../../credits/balanceCounter";
import { EXTRACTION_COST_CONSTANTS } from "../../../../lib/extraction/cost-estimate";
import { assertValidJobTransition, type JobStatus } from "../../stateMachine";

/**
 * Chunk size for the scheduler-chained fan-out. Each invocation
 * processes at most CHUNK_SIZE papers (read paper, optionally reserve,
 * launch workflow, patch paperWorkflowId). Sized so a single chunk's
 * read+write+workflow-start budget is well under the ~8000-op /
 * ~60s mutation ceiling. 1000 papers → 40 sequential chunks.
 */
const CHUNK_SIZE = 25;

export const launchPaperWorkflowsForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    paperIds: v.array(v.id("extractionPapers")),
    expectedEpoch: v.number(),
    pdfEnabled: v.boolean(),
    questionConcurrency: v.number(),
    // Plan extraction-fanout-chunking/01 — chunked scheduler chain.
    // Callers omit it on first invocation (defaults to 0 below); the
    // mutation re-schedules itself with `offset += CHUNK_SIZE` until
    // the full paperIds list is exhausted.
    offset: v.optional(v.number()),
  },
  returns: v.object({
    launched: v.number(),
    reserved: v.number(),
    creditsExhausted: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    launched: number;
    reserved: number;
    creditsExhausted: boolean;
  }> => {
    const offset = args.offset ?? 0;

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return { launched: 0, reserved: 0, creditsExhausted: false };
    }

    if ((job.runEpoch ?? 0) !== args.expectedEpoch) {
      return { launched: 0, reserved: 0, creditsExhausted: false };
    }

    if (
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.status === "completed" ||
      job.status === "paused" ||
      job.status === "creditsExhausted"
    ) {
      return { launched: 0, reserved: 0, creditsExhausted: false };
    }

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const perQuestionCredit = args.pdfEnabled
      ? EXTRACTION_COST_CONSTANTS.PDF_Q_CREDIT_HIGH
      : EXTRACTION_COST_CONSTANTS.ABSTRACT_Q_CREDIT_HIGH;
    const perPaperBudget = questions.length * perQuestionCredit;

    // Pre-flight runs only on the first chunk. It scans the FULL
    // paperIds list (not just this chunk's slice) to make a single
    // up-front go/no-go decision: either every paper that needs a
    // reservation fits, or the job flips to creditsExhausted before
    // any reservation is taken. Subsequent chunks (offset > 0) skip
    // the scan; their slices process whatever already reserved.
    if (offset === 0) {
      let totalFreshNeeded = 0;
      for (const paperId of args.paperIds) {
        const paper = await ctx.db.get(paperId);
        if (!paper) continue;
        if (
          paper.status === "completed" ||
          paper.status === "failed" ||
          paper.status === "download_failed" ||
          paper.status === "indexing_failed"
        ) {
          continue;
        }
        if (paper.questionsBilled === true) continue;
        if (paper.reservationId === undefined) totalFreshNeeded++;
      }
      const totalReservationNeeded = totalFreshNeeded * perPaperBudget;
      if (totalReservationNeeded > 0) {
        const credits = await ctx.db
          .query("credits")
          .withIndex("by_user", (q) => q.eq("userId", job.userId))
          .unique();
        const available = credits
          ? (await readBalance(ctx, credits._id)).total
          : 0;
        if (available < totalReservationNeeded) {
          assertValidJobTransition(
            job.status as JobStatus,
            "creditsExhausted",
          );
          await ctx.db.patch(args.jobId, {
            status: "creditsExhausted",
            pausedAt: Date.now(),
            pausedFromStatus: job.status,
            error: {
              code: "insufficient_credits",
              message: `Need ~${totalReservationNeeded} credits to extract ${totalFreshNeeded} papers × ${questions.length} questions but only have ${available}`,
              at: Date.now(),
            },
            updatedAt: Date.now(),
          });
          return {
            launched: 0,
            reserved: 0,
            creditsExhausted: true,
          };
        }
      }
    }

    const chunkIds = args.paperIds.slice(offset, offset + CHUNK_SIZE);

    type PaperPlan =
      | { paperId: typeof args.paperIds[number]; kind: "needs-reservation" }
      | { paperId: typeof args.paperIds[number]; kind: "already-reserved" }
      | { paperId: typeof args.paperIds[number]; kind: "already-launched" };
    const plans: PaperPlan[] = [];

    for (const paperId of chunkIds) {
      const paper = await ctx.db.get(paperId);
      if (!paper) continue;
      if (
        paper.status === "completed" ||
        paper.status === "failed" ||
        paper.status === "download_failed" ||
        paper.status === "indexing_failed"
      ) {
        continue;
      }
      if (paper.questionsBilled === true) continue;
      // Launch idempotency: a Convex retry of this chunk re-runs the
      // whole handler with the same args. If the paper already carries
      // a workflowId pinned to the current epoch, skip the launch.
      if (
        paper.paperWorkflowId !== undefined &&
        paper.paperWorkflowEpoch === args.expectedEpoch
      ) {
        plans.push({ paperId, kind: "already-launched" });
        continue;
      }
      if (paper.reservationId !== undefined) {
        plans.push({ paperId, kind: "already-reserved" });
      } else {
        plans.push({ paperId, kind: "needs-reservation" });
      }
    }

    let reserved = 0;
    for (const plan of plans) {
      if (plan.kind !== "needs-reservation") continue;
      const paper = await ctx.db.get(plan.paperId);
      if (!paper) continue;
      if (paper.reservationId !== undefined) continue;
      const result = await reserveCreditsTransaction(ctx, {
        userId: job.userId,
        amount: perPaperBudget,
        description: `AI: Extraction reservation (${paper.openalexId})`,
        jobId: args.jobId,
        paperId: plan.paperId,
        billingType: "extraction_llm",
      });
      if (result.reservationId !== null) {
        await ctx.db.patch(plan.paperId, {
          reservationId: result.reservationId,
        });
        reserved++;
      }
    }

    let launched = 0;
    for (const plan of plans) {
      if (plan.kind === "already-launched") continue;
      const workflowId = await workflow.start(
        ctx,
        internal.extraction.workflow.paperPipelineWorkflow,
        {
          jobId: args.jobId,
          paperId: plan.paperId,
          expectedEpoch: args.expectedEpoch,
          pdfEnabled: args.pdfEnabled,
          questionConcurrency: args.questionConcurrency,
        },
        { startAsync: true },
      );
      await ctx.db.patch(plan.paperId, {
        paperWorkflowId: workflowId,
        paperWorkflowEpoch: args.expectedEpoch,
      });
      launched++;
    }

    if (offset + CHUNK_SIZE < args.paperIds.length) {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.fanout
          .launchPaperWorkflowsForJob,
        {
          jobId: args.jobId,
          paperIds: args.paperIds,
          expectedEpoch: args.expectedEpoch,
          pdfEnabled: args.pdfEnabled,
          questionConcurrency: args.questionConcurrency,
          offset: offset + CHUNK_SIZE,
        },
      );
    }

    return { launched, reserved, creditsExhausted: false };
  },
});

/**
 * Retry fan-out — no reservation step.
 *
 * Retries are intentionally billing-free at this layer. The retry
 * mutation (`applyRetryResetTx`) resets `result.status = "pending"` for
 * retryable questions but does NOT clear `paper.questionsBilled`. When
 * the new attempt's `finalizePaper` runs, the `questionsBilled === true`
 * gate short-circuits the credit branch entirely, so no new debit is
 * recorded — the original per-paper bill (placed when the paper first
 * finalized) is reused, and any LLM cost differential against the new
 * attempts is absorbed.
 *
 * Clearing `questionsBilled` to "re-bill" would double-charge the
 * already-completed questions on the paper, because `finalizePaper`
 * sums `creditsUsed` across ALL the paper's result rows — completed
 * ones too — not the delta versus the prior attempt.
 */
export const launchRetryPaperWorkflowsForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    paperWork: v.array(
      v.object({
        paperId: v.id("extractionPapers"),
        questionKeys: v.array(v.string()),
      }),
    ),
    expectedEpoch: v.number(),
    questionConcurrency: v.number(),
  },
  returns: v.object({ launched: v.number() }),
  handler: async (ctx, args): Promise<{ launched: number }> => {
    let launched = 0;
    for (const { paperId, questionKeys } of args.paperWork) {
      await workflow.start(
        ctx,
        internal.extraction.workflow.retryPaperPipelineWorkflow,
        {
          jobId: args.jobId,
          paperId,
          questionKeys,
          expectedEpoch: args.expectedEpoch,
          questionConcurrency: args.questionConcurrency,
        },
        { startAsync: true },
      );
      launched++;
    }
    return { launched };
  },
});
