import { v } from "convex/values";
import type { WorkId } from "@convex-dev/workpool";
import { internal } from "../../_generated/api";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { extractionPaperPool } from "../../workpool";
import { extractionQueueStatusValidator } from "../validators";
import {
  admitPaperQuestionCreditsTx,
  clearPaperQuestionAdmissionTx,
  getPaperQuestionAdmissionEstimate,
  markJobCreditsExhaustedTx,
  readQuestionAdmissionBalanceTx,
} from "../creditAdmissions";
import { isInitialQueueEligible, isRetryQueueEligible } from "./helpers";
import {
  getQueueCapacity,
  shouldClearQueueLease,
  type ExtractionQueueStatus,
} from "./status";

type QueueKind = Doc<"extractionPaperQueue">["kind"];

type EnqueueQueueRowsResult = {
  enqueued: number;
  existing: number;
  skipped: number;
};

type QueueCandidate = {
  paperId: Id<"extractionPapers">;
  questionKeys?: string[];
};

type LeaseRowsResult = {
  leased: Array<Id<"extractionPaperQueue">>;
  activeCount: number;
  capacity: number;
};

type LeaseRowsArgs = {
  jobId: Id<"extractionJobs">;
  expectedEpoch: number;
  paperConcurrency: number;
  leaseOwner: string;
  leaseMs: number;
};

type DispatchWindowResult = {
  activeCount: number;
  capacity: number;
  dispatched: number;
  admitted: number;
  creditsExhausted: boolean;
};

type CancelQueueRowsResult = {
  cancelled: number;
  cancelRequested: number;
};

async function loadQueueRowsByStatus(
  ctx: MutationCtx,
  {
    jobId,
    runEpoch,
    status,
    limit,
  }: {
    jobId: Id<"extractionJobs">;
    runEpoch: number;
    status: ExtractionQueueStatus;
    limit?: number;
  },
): Promise<Array<Doc<"extractionPaperQueue">>> {
  const normalizedLimit =
    limit === undefined ? undefined : Math.max(0, Math.floor(limit));
  if (normalizedLimit === 0) return [];
  const query = ctx.db
    .query("extractionPaperQueue")
    .withIndex("by_job_and_epoch_and_status", (q) =>
      q.eq("jobId", jobId).eq("runEpoch", runEpoch).eq("status", status),
    );
  return normalizedLimit === undefined
    ? await query.collect()
    : await query.take(normalizedLimit);
}

async function loadPendingQueueRowsForLease(
  ctx: MutationCtx,
  {
    jobId,
    runEpoch,
    capacity,
  }: {
    jobId: Id<"extractionJobs">;
    runEpoch: number;
    capacity: number;
  },
): Promise<Array<Doc<"extractionPaperQueue">>> {
  const normalizedCapacity = Math.max(0, Math.floor(capacity));
  if (normalizedCapacity === 0) return [];
  return await ctx.db
    .query("extractionPaperQueue")
    .withIndex(
      "by_job_and_epoch_and_status_and_priority_and_createdAt",
      (q) =>
        q
          .eq("jobId", jobId)
          .eq("runEpoch", runEpoch)
          .eq("status", "pending"),
    )
    .take(normalizedCapacity);
}

async function loadExistingQueueRow(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
  expectedEpoch: number,
  kind: QueueKind,
): Promise<Doc<"extractionPaperQueue"> | null> {
  return await ctx.db
    .query("extractionPaperQueue")
    .withIndex("by_paper_and_epoch_and_kind", (q) =>
      q.eq("paperId", paperId).eq("runEpoch", expectedEpoch).eq("kind", kind),
    )
    .unique();
}

async function insertPendingQueueRow(
  ctx: MutationCtx,
  {
    jobId,
    userId,
    paperId,
    runEpoch,
    kind,
    priority,
    attempt,
    questionKeys,
    now,
  }: {
    jobId: Id<"extractionJobs">;
    userId: Id<"users">;
    paperId: Id<"extractionPapers">;
    runEpoch: number;
    kind: QueueKind;
    priority: number;
    attempt: number;
    questionKeys?: string[];
    now: number;
  },
): Promise<Id<"extractionPaperQueue">> {
  const queueRow: Omit<Doc<"extractionPaperQueue">, "_id" | "_creationTime"> = {
    jobId,
    userId,
    paperId,
    runEpoch,
    kind,
    status: "pending",
    priority,
    attempt,
    ...(questionKeys !== undefined ? { questionKeys } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return await ctx.db.insert("extractionPaperQueue", queueRow);
}

async function enqueuePaperQueueRows(
  ctx: MutationCtx,
  {
    jobId,
    expectedEpoch,
    kind,
    priority,
    candidates,
    isEligible,
  }: {
    jobId: Id<"extractionJobs">;
    expectedEpoch: number;
    kind: QueueKind;
    priority: number;
    candidates: ReadonlyArray<QueueCandidate>;
    isEligible: (paper: Doc<"extractionPapers">) => boolean;
  },
): Promise<EnqueueQueueRowsResult> {
  const job = await ctx.db.get(jobId);
  if (!job || (job.runEpoch ?? 0) !== expectedEpoch) {
    return {
      enqueued: 0,
      existing: 0,
      skipped: candidates.length,
    };
  }

  const now = Date.now();
  const result: EnqueueQueueRowsResult = {
    enqueued: 0,
    existing: 0,
    skipped: 0,
  };

  for (const candidate of candidates) {
    const paper = await ctx.db.get(candidate.paperId);
    const questionKeys =
      candidate.questionKeys !== undefined
        ? [...new Set(candidate.questionKeys)]
        : undefined;
    if (
      !paper ||
      paper.jobId !== jobId ||
      !isEligible(paper) ||
      (kind === "retry" && (questionKeys?.length ?? 0) === 0)
    ) {
      result.skipped += 1;
      continue;
    }

    const existing = await loadExistingQueueRow(
      ctx,
      candidate.paperId,
      expectedEpoch,
      kind,
    );
    if (existing) {
      result.existing += 1;
      continue;
    }

    await insertPendingQueueRow(ctx, {
      jobId,
      userId: job.userId,
      paperId: candidate.paperId,
      runEpoch: expectedEpoch,
      kind,
      priority,
      attempt: 0,
      questionKeys,
      now,
    });
    result.enqueued += 1;
  }

  return result;
}

export async function enqueueInitialPapersForJobTx(
  ctx: MutationCtx,
  args: {
    jobId: Id<"extractionJobs">;
    paperIds: Array<Id<"extractionPapers">>;
    expectedEpoch: number;
    priority: number;
  },
): Promise<EnqueueQueueRowsResult> {
  return await enqueuePaperQueueRows(ctx, {
    jobId: args.jobId,
    expectedEpoch: args.expectedEpoch,
    kind: "initial",
    priority: args.priority,
    candidates: args.paperIds.map((paperId) => ({ paperId })),
    isEligible: isInitialQueueEligible,
  });
}

export const enqueueInitialPapersForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    paperIds: v.array(v.id("extractionPapers")),
    expectedEpoch: v.number(),
    priority: v.number(),
  },
  returns: v.object({
    enqueued: v.number(),
    existing: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args): Promise<EnqueueQueueRowsResult> => {
    return await enqueueInitialPapersForJobTx(ctx, args);
  },
});

export async function enqueueRetryPapersForJobTx(
  ctx: MutationCtx,
  args: {
    jobId: Id<"extractionJobs">;
    expectedEpoch: number;
    retryPapers: Array<{
      paperId: Id<"extractionPapers">;
      questionKeys: string[];
    }>;
    priority: number;
  },
): Promise<EnqueueQueueRowsResult> {
  return await enqueuePaperQueueRows(ctx, {
    jobId: args.jobId,
    expectedEpoch: args.expectedEpoch,
    kind: "retry",
    priority: args.priority,
    candidates: args.retryPapers,
    isEligible: isRetryQueueEligible,
  });
}

export const enqueueRetryPapersForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    expectedEpoch: v.number(),
    retryPapers: v.array(
      v.object({
        paperId: v.id("extractionPapers"),
        questionKeys: v.array(v.string()),
      }),
    ),
    priority: v.number(),
  },
  returns: v.object({
    enqueued: v.number(),
    existing: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args): Promise<EnqueueQueueRowsResult> => {
    return await enqueueRetryPapersForJobTx(ctx, args);
  },
});

export const leaseNextPaperQueueRows = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    expectedEpoch: v.number(),
    paperConcurrency: v.number(),
    leaseOwner: v.string(),
    leaseMs: v.number(),
  },
  returns: v.object({
    leased: v.array(v.id("extractionPaperQueue")),
    activeCount: v.number(),
    capacity: v.number(),
  }),
  handler: async (ctx, args): Promise<LeaseRowsResult> => {
    return await leaseNextPaperQueueRowsTx(ctx, args);
  },
});

async function leaseNextPaperQueueRowsTx(
  ctx: MutationCtx,
  args: LeaseRowsArgs,
): Promise<LeaseRowsResult> {
  const activeReadLimit = Math.max(0, Math.floor(args.paperConcurrency));
  const [leasedRows, runningRows] = await Promise.all([
    loadQueueRowsByStatus(ctx, {
      jobId: args.jobId,
      runEpoch: args.expectedEpoch,
      status: "leased",
      limit: activeReadLimit,
    }),
    loadQueueRowsByStatus(ctx, {
      jobId: args.jobId,
      runEpoch: args.expectedEpoch,
      status: "running",
      limit: activeReadLimit,
    }),
  ]);
  const activeCount = leasedRows.length + runningRows.length;
  const capacity = getQueueCapacity({
    activeCount,
    paperConcurrency: args.paperConcurrency,
  });
  const pendingRows = await loadPendingQueueRowsForLease(ctx, {
    jobId: args.jobId,
    runEpoch: args.expectedEpoch,
    capacity,
  });
  const selectedIds = pendingRows.map((row) => row._id);

  const now = Date.now();
  const leaseExpiresAt = now + Math.max(0, Math.floor(args.leaseMs));
  await Promise.all(
    selectedIds.map((queueId) =>
      ctx.db.patch(queueId, {
        status: "leased",
        leaseOwner: args.leaseOwner,
        leasedAt: now,
        leaseExpiresAt,
        updatedAt: now,
      }),
    ),
  );

  return {
    leased: selectedIds,
    activeCount,
    capacity,
  };
}

export const dispatchPaperQueueWindow = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    expectedEpoch: v.number(),
    paperConcurrency: v.number(),
    leaseOwner: v.string(),
    leaseMs: v.number(),
    questionConcurrency: v.number(),
    pdfEnabled: v.boolean(),
  },
  returns: v.object({
    activeCount: v.number(),
    capacity: v.number(),
    dispatched: v.number(),
    admitted: v.number(),
    creditsExhausted: v.boolean(),
  }),
  handler: async (ctx, args): Promise<DispatchWindowResult> => {
    return await dispatchPaperQueueWindowTx(ctx, args);
  },
});

export async function dispatchPaperQueueWindowTx(
  ctx: MutationCtx,
  args: {
    jobId: Id<"extractionJobs">;
    expectedEpoch: number;
    paperConcurrency: number;
    leaseOwner: string;
    leaseMs: number;
    questionConcurrency: number;
    pdfEnabled: boolean;
  },
): Promise<DispatchWindowResult> {
  const lease = await leaseNextPaperQueueRowsTx(ctx, args);
  const now = Date.now();
  const leasedRows: Array<Doc<"extractionPaperQueue">> = [];
  for (const queueId of lease.leased) {
    const row = await ctx.db.get(queueId);
    if (row) leasedRows.push(row);
  }

  const job = await ctx.db.get(args.jobId);
  let admitted = 0;
  let creditsExhausted = false;
  const dispatchRows: Array<Doc<"extractionPaperQueue">> = [];
  const rowsToRequeue: Array<Doc<"extractionPaperQueue">> = [];

  if (job) {
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const estimateCredits = getPaperQuestionAdmissionEstimate({
      questionCount: questions.length,
      pdfEnabled: args.pdfEnabled,
    });
    const admissionBalance =
      estimateCredits > 0
        ? await readQuestionAdmissionBalanceTx(ctx, {
            job,
            expectedEpoch: args.expectedEpoch,
          })
        : null;
    let windowAdmissionCredits = 0;

    for (let index = 0; index < leasedRows.length; index += 1) {
      const row = leasedRows[index];
      if (row.kind !== "initial") {
        dispatchRows.push(row);
        continue;
      }

      const paper = await ctx.db.get(row.paperId);
      if (!paper) {
        rowsToRequeue.push(row);
        continue;
      }

      const alreadyAdmitted =
        paper.admittedRunEpoch === args.expectedEpoch &&
        paper.admittedEstimateCredits !== undefined;
      if (
        !alreadyAdmitted &&
        admissionBalance !== null &&
        admissionBalance.availableCredits - windowAdmissionCredits <
          estimateCredits
      ) {
        const activeAdmissionCredits =
          admissionBalance.activeAdmissionCredits + windowAdmissionCredits;
        if (activeAdmissionCredits <= 0) {
          await markJobCreditsExhaustedTx(ctx, job, {
            estimateNeeded: estimateCredits,
            papersNeeded: 1,
            questionCount: questions.length,
            available:
              admissionBalance.availableCredits - windowAdmissionCredits,
          });
          creditsExhausted = true;
        }
        rowsToRequeue.push(...leasedRows.slice(index));
        break;
      }

      const admission = await admitPaperQuestionCreditsTx(ctx, {
        paper,
        expectedEpoch: args.expectedEpoch,
        estimateCredits,
      });
      if (admission.status === "admitted") {
        admitted += 1;
        windowAdmissionCredits += admission.estimateCredits;
      }
      dispatchRows.push(row);
    }
  } else {
    dispatchRows.push(...leasedRows);
  }

  if (creditsExhausted) {
    await Promise.all(
      leasedRows.map(async (leasedRow) => {
        await clearPaperQuestionAdmissionTx(ctx, leasedRow.paperId);
        await ctx.db.patch(leasedRow._id, {
          status: "parked",
          updatedAt: now,
          leaseOwner: undefined,
          leasedAt: undefined,
          leaseExpiresAt: undefined,
        });
      }),
    );
    return {
      activeCount: lease.activeCount,
      capacity: lease.capacity,
      dispatched: 0,
      admitted: 0,
      creditsExhausted: true,
    };
  }

  if (rowsToRequeue.length > 0) {
    await Promise.all(
      rowsToRequeue.map((leasedRow) =>
        ctx.db.patch(leasedRow._id, {
          status: "pending",
          updatedAt: now,
          leaseOwner: undefined,
          leasedAt: undefined,
          leaseExpiresAt: undefined,
        }),
      ),
    );
  }

  const workIds =
    dispatchRows.length > 0
      ? await extractionPaperPool.enqueueActionBatch(
          ctx,
          internal.extraction.paperWorker.runPaperQueueItem,
          dispatchRows.map((row) => ({
            queueId: row._id,
            expectedEpoch: args.expectedEpoch,
            paperConcurrency: args.paperConcurrency,
            questionConcurrency: args.questionConcurrency,
            pdfEnabled: args.pdfEnabled,
          })),
          { retry: true },
        )
      : [];

  await Promise.all(
    dispatchRows.map((row, index) =>
      ctx.db.patch(row._id, { workId: workIds[index], updatedAt: now }),
    ),
  );

  return {
    activeCount: lease.activeCount,
    capacity: lease.capacity,
    dispatched: dispatchRows.length,
    admitted,
    creditsExhausted: false,
  };
}

export async function cancelPaperQueueRowsForJobTx(
  ctx: MutationCtx,
  args: { jobId: Id<"extractionJobs"> },
): Promise<CancelQueueRowsResult> {
  const cancellableStatuses: ExtractionQueueStatus[] = [
    "pending",
    "leased",
    "running",
    "parked",
  ];
  const rows = (
    await Promise.all(
      cancellableStatuses.map((status) =>
        ctx.db
          .query("extractionPaperQueue")
          .withIndex("by_job_and_status", (q) =>
            q.eq("jobId", args.jobId).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();

  const now = Date.now();
  let cancelRequested = 0;
  for (const row of rows) {
    if (row.workId !== undefined) {
      await extractionPaperPool.cancel(ctx, row.workId as WorkId);
      cancelRequested += 1;
    }
    await ctx.db.patch(row._id, {
      status: "cancelled",
      updatedAt: now,
      leaseOwner: undefined,
      leasedAt: undefined,
      leaseExpiresAt: undefined,
    });
    await clearPaperQuestionAdmissionTx(ctx, row.paperId);
  }

  return { cancelled: rows.length, cancelRequested };
}

export const cancelPaperQueueRowsForJob = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    cancelled: v.number(),
    cancelRequested: v.number(),
  }),
  handler: async (ctx, args): Promise<CancelQueueRowsResult> => {
    return await cancelPaperQueueRowsForJobTx(ctx, args);
  },
});

export const updatePaperQueueStatus = internalMutation({
  args: {
    queueId: v.id("extractionPaperQueue"),
    expectedEpoch: v.number(),
    status: extractionQueueStatusValidator,
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const row = await ctx.db.get(args.queueId);
    if (!row || row.runEpoch !== args.expectedEpoch) {
      return { applied: false };
    }

    const clearLease = shouldClearQueueLease(args.status);
    await ctx.db.patch(args.queueId, {
      status: args.status,
      updatedAt: Date.now(),
      ...(clearLease
        ? {
            leaseOwner: undefined,
            leasedAt: undefined,
            leaseExpiresAt: undefined,
          }
        : {}),
    });
    if (clearLease) {
      await clearPaperQuestionAdmissionTx(ctx, row.paperId);
    }
    return { applied: true };
  },
});
