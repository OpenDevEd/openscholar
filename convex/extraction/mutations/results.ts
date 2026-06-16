/**
 * Extraction result mutations — the write-side of the result/review
 * domain, plus the job-status primitive used by queue workers.
 *
 * Paper-batch lifecycle:
 *   - recordQuestionBatch upserts all completed/failed question rows for
 *     one paper batch in a single mutation.
 *   - finalizePaper aggregates those rows through aggregatePaperStatus,
 *     flips the paper terminal, settles one paper-level credit debit, and
 *     fires maybeFinalizeJob. Re-running after terminal is a no-op.
 */

import { internalMutation, type MutationCtx } from "../../_generated/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { deductCreditsTransaction } from "../../credits/internal";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { isTerminalPaperStatus, markPaperTerminalTx } from "../paperLifecycle";
import { recordCreditSpend } from "../aggregates";
import {
  answerValidator,
  citationStatusValidator,
  citationValidator,
  classifiedErrorValidator,
  retrievalDiagnosticsValidator,
  structuredErrorValidator,
} from "../validators";
import { aggregatePaperStatus } from "@/lib/extraction/paper-status";
import type { ErrorCode } from "@/lib/errors/taxonomy";

export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    status: v.union(
      v.literal("pending"),
      v.literal("downloading_pdfs"),
      v.literal("indexing"),
      v.literal("extracting"),
      v.literal("creditsExhausted"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    totalPapers: v.optional(v.number()),
    expectedEpoch: v.optional(v.number()),
    // Optional structured error stamped on the job when we transition
    // to a failure-ish state (e.g. creditsExhausted). Lets the UI pick
    // a localized title/body without parsing the message.
    error: v.optional(structuredErrorValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) return null;
    if (
      args.expectedEpoch !== undefined &&
      (job.runEpoch ?? 0) !== args.expectedEpoch
    ) {
      return null;
    }

    // Terminal states are sticky. A late worker update must not roll
    // a finalized job back to an active state.
    const isTerminal =
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.status === "completed";
    if (isTerminal && args.status !== job.status) {
      return null;
    }

    // Idempotency for creditsExhausted: if the job is already
    // creditsExhausted, a concurrent second worker catch site
    // transitioning it again is a no-op.
    if (
      args.status === "creditsExhausted" &&
      job.status === "creditsExhausted"
    ) {
      return null;
    }

    assertValidJobTransition(job.status as JobStatus, args.status as JobStatus);

    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.totalPapers !== undefined) {
      updates.totalPapers = args.totalPapers;
    }
    if (args.error !== undefined) {
      updates.error = args.error;
    }

    await ctx.db.patch("extractionJobs", args.jobId, updates);
    return null;
  },
});

// ──────────────────────────────────────────────────────────────────────
// Paper-level result persistence
// ──────────────────────────────────────────────────────────────────────

/**
 * Return true if the parent job has reached a terminal state — any
 * result-persistence call coming in after that must be a no-op so a
 * late workpool retry cannot resurrect a cancelled/failed/completed
 * job.
 */
function isJobTerminal(
  job: { status?: string } | null | undefined,
): boolean {
  if (!job) return false;
  return (
    job.status === "cancelled" ||
    job.status === "failed" ||
    job.status === "completed"
  );
}

function matchesExpectedEpoch(
  job: { runEpoch?: number } | null | undefined,
  expectedEpoch?: number,
): boolean {
  if (expectedEpoch === undefined) return true;
  return (job?.runEpoch ?? 0) === expectedEpoch;
}

const oneAnswerBody = v.object({
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  retrievalDiagnostics: v.optional(retrievalDiagnosticsValidator),
  pdfContentUsed: v.optional(v.boolean()),
});

type OneAnswerBody = Infer<typeof oneAnswerBody>;
type ClassifiedErrorInput = Infer<typeof classifiedErrorValidator>;
type ResultFields = Omit<Doc<"extractionResults">, "_id" | "_creationTime">;

async function readExistingResultForQuestion(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
  questionKey: string,
): Promise<Doc<"extractionResults"> | null> {
  return await ctx.db
    .query("extractionResults")
    .withIndex("by_paper_question", (q) =>
      q.eq("paperId", paperId).eq("questionKey", questionKey),
    )
    .unique();
}

async function readExistingResultsForQuestionKeys(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
  questionKeys: ReadonlyArray<string>,
): Promise<Map<string, Doc<"extractionResults">>> {
  const uniqueKeys = [...new Set(questionKeys)];
  const entries = await Promise.all(
    uniqueKeys.map(async (questionKey) => {
      const row = await readExistingResultForQuestion(ctx, paperId, questionKey);
      return [questionKey, row] as const;
    }),
  );
  return new Map(
    entries.flatMap(([questionKey, row]) =>
      row ? [[questionKey, row] as const] : [],
    ),
  );
}

function buildCompletedResultFields({
  paper,
  paperId,
  questionKey,
  result,
  creditsUsed,
  existing,
  now,
}: {
  paper: Doc<"extractionPapers">;
  paperId: Id<"extractionPapers">;
  questionKey: string;
  result: OneAnswerBody;
  creditsUsed: number;
  existing: Doc<"extractionResults"> | null | undefined;
  now: number;
}): ResultFields {
  return {
    jobId: paper.jobId,
    paperId,
    questionKey,
    answer: result.answer,
    confidence: result.confidence,
    reasoning: result.reasoning,
    citations: result.citations,
    citationStatus: result.citationStatus,
    retrievalDiagnostics: result.retrievalDiagnostics,
    pdfContentUsed: result.pdfContentUsed,
    creditsUsed: (existing?.creditsUsed ?? 0) + creditsUsed,
    status: "completed",
    billed: true,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    processedAt: now,
  };
}

function buildFailedResultFields({
  paper,
  paperId,
  questionKey,
  error,
  existing,
  now,
}: {
  paper: Doc<"extractionPapers">;
  paperId: Id<"extractionPapers">;
  questionKey: string;
  error: ClassifiedErrorInput;
  existing: Doc<"extractionResults"> | null | undefined;
  now: number;
}): ResultFields {
  return {
    jobId: paper.jobId,
    paperId,
    questionKey,
    answer: null,
    confidence: 0,
    reasoning: `Extraction failed: ${error.message}`,
    citations: [],
    citationStatus: "extraction_error",
    retrievalDiagnostics: undefined,
    pdfContentUsed: false,
    status: "failed",
    billed: false,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastError: {
      code: error.code,
      message: error.message,
      ...(error.context !== undefined ? { context: error.context } : {}),
      ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
      ...(error.providerName !== undefined
        ? { providerName: error.providerName }
        : {}),
      at: now,
    },
    processedAt: now,
  };
}

function toResultDoc(
  id: Id<"extractionResults">,
  creationTime: number,
  fields: ResultFields,
): Doc<"extractionResults"> {
  return { _id: id, _creationTime: creationTime, ...fields };
}

const batchSkipReasonValidator = v.union(
  v.literal("paper_missing"),
  v.literal("job_missing"),
  v.literal("stale_epoch"),
  v.literal("job_terminal"),
  v.literal("paused"),
  v.literal("credits_exhausted"),
  v.literal("not_extracting"),
);

function getBatchSkipReason(
  job: { status?: string; runEpoch?: number } | null | undefined,
  expectedEpoch?: number,
):
  | "job_missing"
  | "stale_epoch"
  | "job_terminal"
  | "paused"
  | "credits_exhausted"
  | "not_extracting"
  | null {
  if (!job) return "job_missing";
  if (!matchesExpectedEpoch(job, expectedEpoch)) return "stale_epoch";
  if (isJobTerminal(job)) return "job_terminal";
  if (job.status === "paused") return "paused";
  if (job.status === "creditsExhausted") return "credits_exhausted";
  if (job.status !== "extracting") return "not_extracting";
  return null;
}

export const recordQuestionBatch = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    expectedEpoch: v.optional(v.number()),
    completed: v.array(
      v.object({
        questionKey: v.string(),
        result: oneAnswerBody,
        creditsUsed: v.number(),
      }),
    ),
    failed: v.array(
      v.object({
        questionKey: v.string(),
        error: classifiedErrorValidator,
      }),
    ),
  },
  returns: v.union(
    v.object({
      status: v.literal("skipped"),
      reason: batchSkipReasonValidator,
    }),
    v.object({
      status: v.literal("ok"),
      completed: v.array(v.string()),
      failed: v.array(v.string()),
      skipped: v.array(
        v.object({
          questionKey: v.string(),
          reason: v.literal("already_billed"),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) {
      return { status: "skipped" as const, reason: "paper_missing" as const };
    }

    const job = await ctx.db.get("extractionJobs", paper.jobId);
    const skipReason = getBatchSkipReason(job, args.expectedEpoch);
    if (skipReason) {
      return { status: "skipped" as const, reason: skipReason };
    }

    const existingByQuestion = await readExistingResultsForQuestionKeys(
      ctx,
      args.paperId,
      [
        ...args.completed.map((item) => item.questionKey),
        ...args.failed.map((item) => item.questionKey),
      ],
    );
    const now = Date.now();
    const completed: string[] = [];
    const failed: string[] = [];
    const skipped: Array<{
      questionKey: string;
      reason: "already_billed";
    }> = [];

    for (const item of args.completed) {
      const existing = existingByQuestion.get(item.questionKey);
      if (existing?.billed) {
        skipped.push({
          questionKey: item.questionKey,
          reason: "already_billed",
        });
        continue;
      }

      const fields = buildCompletedResultFields({
        paper,
        paperId: args.paperId,
        questionKey: item.questionKey,
        result: item.result,
        creditsUsed: item.creditsUsed,
        existing,
        now,
      });

      if (existing) {
        await ctx.db.replace(existing._id, fields);
        existingByQuestion.set(
          item.questionKey,
          toResultDoc(existing._id, existing._creationTime, fields),
        );
      } else {
        const rowId = await ctx.db.insert("extractionResults", fields);
        existingByQuestion.set(
          item.questionKey,
          toResultDoc(rowId, now, fields),
        );
      }
      completed.push(item.questionKey);
    }

    for (const item of args.failed) {
      const existing = existingByQuestion.get(item.questionKey);
      if (existing?.billed) {
        skipped.push({
          questionKey: item.questionKey,
          reason: "already_billed",
        });
        continue;
      }

      const fields = buildFailedResultFields({
        paper,
        paperId: args.paperId,
        questionKey: item.questionKey,
        error: item.error,
        existing,
        now,
      });

      if (existing) {
        await ctx.db.replace(existing._id, fields);
        existingByQuestion.set(
          item.questionKey,
          toResultDoc(existing._id, existing._creationTime, fields),
        );
      } else {
        const rowId = await ctx.db.insert("extractionResults", fields);
        existingByQuestion.set(
          item.questionKey,
          toResultDoc(rowId, now, fields),
        );
      }
      failed.push(item.questionKey);
    }

    return {
      status: "ok" as const,
      completed,
      failed,
      skipped,
    };
  },
});

/**
 * Collapse the per-question extractionResults rows into a paper-level
 * terminal status. Called by the worker once all per-question attempts
 * have either succeeded or exhausted their retry budget. Idempotent:
 * running on an already-terminal paper is a no-op.
 *
 * No `expectedEpoch` arg by design. A pause + resume mid-fanout bumps
 * `job.runEpoch`, but result rows that finished at the older epoch are
 * still authoritative — they captured real LLM work. The paper-status idempotency
 * guard above plus the `job.status === "extracting"` gate below are
 * sufficient: if the paper has rolled up to a terminal state and the
 * job is still in flight, finalizing is correct regardless of how many
 * epoch bumps happened during fan-out. Guarding on a captured epoch
 * caused the stuck-at-99% bug — every cross-epoch finalize was a
 * silent no-op, the worker returned success, and the job never
 * cascaded to completed.
 */
export const finalizePaper = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;
    if (isTerminalPaperStatus(paper.status)) return null;

    const job = await ctx.db.get("extractionJobs", paper.jobId);
    if (isJobTerminal(job)) return null;
    if (job?.status !== "extracting") return null;

    const [resultsForPaper, questions] = await Promise.all([
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
        .collect(),
      ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", paper.jobId))
        .collect(),
    ]);

    const byKey = new Map(resultsForPaper.map((r) => [r.questionKey, r]));
    const rollupInputs = questions.map((q) => {
      const r = byKey.get(q.key);
      if (!r) {
        return { status: "pending" as const };
      }
      // Older dev rows may lack `status` because schema validation is off.
      // Treat them as completed so local disposable data can still finalize.
      const status = r.status ?? ("completed" as const);
      const code = r.lastError?.code as ErrorCode | undefined;
      return {
        status,
        lastError: code !== undefined ? { code } : undefined,
        attemptCount: r.attemptCount,
      };
    });

    const rollup = aggregatePaperStatus(rollupInputs);

    // Not done yet — a question is still pending or a retryable failure
    // hasn't exhausted its budget. Leave the paper in its current
    // non-terminal state and let a later finalizePaper call finish the
    // job once the remaining question steps land.
    if (rollup.status === "pending" || rollup.status === "extracting") {
      return null;
    }

    const terminalStatus = rollup.status === "failed" ? "failed" : "completed";
    const anyPdfUsed = resultsForPaper.some((r) => r.pdfContentUsed);

    // Per-paper credit debit. Tier C: the per-question creditsUsed now
    // lives on each extractionResults row (no longer accumulated on the
    // paper row by an OCC-contended applyResultProjectionWrite). Sum
    // them here and settle the wallet ONCE on the terminal transition.
    // `questionsBilled` is the idempotency gate so an adversarial
    // reset-then-rerun cannot re-bill — mirrors the `indexingBilled`
    // precedent.
    // allowPartial:true drains the wallet rather than throwing
    // INSUFFICIENT_CREDITS mid-fanout. Queue admission already checked
    // the HIGH estimate before starting this paper; final billing is the
    // single settled usage row.
    const creditsToDebit = resultsForPaper.reduce(
      (sum, r) => sum + (r.creditsUsed ?? 0),
      0,
    );
    if (!paper.questionsBilled && job) {
      let deducted = 0;
      let billingOccurred = false;
      if (creditsToDebit > 0) {
        const result = await deductCreditsTransaction(ctx, {
          userId: job.userId,
          amount: creditsToDebit,
          description: `AI: Extraction (${paper.openalexId} — ${rollup.completedQuestions} questions)`,
          jobId: paper.jobId,
          paperId: args.paperId,
          billingType: "extraction_llm",
          allowPartial: true,
        });
        deducted = result.deducted;
        billingOccurred = true;
      }
      if (deducted > 0) {
        await recordCreditSpend(ctx, {
          jobId: paper.jobId,
          id: args.paperId,
          creditsUsed: deducted,
        });
      }
      if (billingOccurred || paper.admittedEstimateCredits !== undefined) {
        await ctx.db.patch(args.paperId, {
          ...(billingOccurred ? { questionsBilled: true } : {}),
          admittedEstimateCredits: undefined,
          admittedRunEpoch: undefined,
          admittedAt: undefined,
        });
      }
    }

    await markPaperTerminalTx(ctx, args.paperId, terminalStatus, {
      creditsUsed: creditsToDebit > 0 ? creditsToDebit : undefined,
      pdfContentUsed: anyPdfUsed ? true : undefined,
    });

    await ctx.runMutation(
      internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
      { jobId: paper.jobId },
    );

    console.log(
      `[finalizePaper] ${args.paperId} → ${terminalStatus} (completed=${rollup.completedQuestions} failed=${rollup.failedQuestions})`,
    );
    return null;
  },
});
