/**
 * Shared paper-lifecycle helpers used by multiple mutation submodules
 * (papers, results, onComplete). Plain TS module — exports helper
 * functions only, no Convex function registrations.
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  assertValidPaperTransition,
  type PaperStatus,
} from "./stateMachine";

/**
 * Terminal paper statuses. Any transition into one of these is
 * irreversible; the per-job counter on `extractionJobs` is incremented
 * exactly once per paper when it lands here, so `maybeFinalizeJob`
 * decides "done" in O(1).
 */
export type TerminalPaperStatus =
  | "completed"
  | "failed"
  | "download_failed"
  | "indexing_failed";

export function isTerminalPaperStatus(
  status: Doc<"extractionPapers">["status"],
): status is TerminalPaperStatus {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "download_failed" ||
    status === "indexing_failed"
  );
}

/**
 * Transition a paper into a terminal state and bump the owning job's
 * per-state counter atomically. Idempotent: if the paper is already
 * terminal, the counter is not re-incremented. Non-processable papers
 * do not contribute to the counter since they are excluded from
 * `extractionJobs.totalPapers` at enqueue time.
 */
export async function markPaperTerminalTx(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
  newStatus: TerminalPaperStatus,
  extras: {
    errorMessage?: string;
    completedAt?: number;
    creditsUsed?: number;
    storageId?: Id<"_storage">;
    extractionBilled?: boolean;
    pdfContentUsed?: boolean;
  } = {},
): Promise<{ applied: boolean; paper: Doc<"extractionPapers"> | null }> {
  const paper = await ctx.db.get("extractionPapers", paperId);
  if (!paper) return { applied: false, paper: null };

  if (isTerminalPaperStatus(paper.status)) {
    return { applied: false, paper };
  }

  assertValidPaperTransition(
    paper.status as PaperStatus,
    newStatus as PaperStatus,
  );

  const patch: Partial<Doc<"extractionPapers">> = {
    status: newStatus,
    completedAt: extras.completedAt ?? Date.now(),
  };
  if (extras.errorMessage !== undefined) patch.errorMessage = extras.errorMessage;
  if (extras.creditsUsed !== undefined) patch.creditsUsed = extras.creditsUsed;
  if (extras.storageId !== undefined) patch.storageId = extras.storageId;
  if (extras.extractionBilled !== undefined) {
    patch.extractionBilled = extras.extractionBilled;
  }
  if (extras.pdfContentUsed !== undefined) {
    patch.pdfContentUsed = extras.pdfContentUsed;
  }

  await ctx.db.patch("extractionPapers", paperId, patch);

  if (paper.processable !== false) {
    const job = await ctx.db.get("extractionJobs", paper.jobId);
    if (job) {
      const isSuccess = newStatus === "completed";
      await ctx.db.patch("extractionJobs", paper.jobId, {
        processedPapers: job.processedPapers + (isSuccess ? 1 : 0),
        failedPapers: job.failedPapers + (isSuccess ? 0 : 1),
        updatedAt: Date.now(),
      });
    }
  }

  return { applied: true, paper };
}
