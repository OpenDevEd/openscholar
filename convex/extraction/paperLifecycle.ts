/**
 * Shared paper-lifecycle helpers used by multiple mutation submodules
 * (papers, results, onComplete). Plain TS module — exports helper
 * functions only, no Convex function registrations.
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ClassifiedError } from "@/lib/errors/taxonomy";
import {
  assertValidPaperTransition,
  type PaperStatus,
} from "./stateMachine";
import { recomputePaperListProjection } from "./listProjection";
import { incPaperOutcome } from "./jobCounters";

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
    error?: ClassifiedError;
    completedAt?: number;
    creditsUsed?: number;
    storageId?: Id<"_storage">;
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

  const completedAt = extras.completedAt ?? Date.now();
  const patch: Partial<Doc<"extractionPapers">> = {
    status: newStatus,
    completedAt,
  };
  if (extras.creditsUsed !== undefined) patch.creditsUsed = extras.creditsUsed;
  if (extras.storageId !== undefined) patch.storageId = extras.storageId;
  if (extras.pdfContentUsed !== undefined) {
    patch.pdfContentUsed = extras.pdfContentUsed;
  }

  // Structured error: persist on paper.lastError, append-only row to
  // extractionPaperErrors, and bump attemptCount. Always do this if an
  // error is supplied — even on `failed` retries — so the per-paper
  // history reflects every attempt.
  let attempt = paper.attemptCount ?? 0;
  if (extras.error !== undefined) {
    attempt += 1;
    patch.attemptCount = attempt;
    patch.lastError = {
      code: extras.error.code,
      message: extras.error.message,
      ...(extras.error.context !== undefined ? { context: extras.error.context } : {}),
      ...(extras.error.httpStatus !== undefined ? { httpStatus: extras.error.httpStatus } : {}),
      ...(extras.error.providerName !== undefined
        ? { providerName: extras.error.providerName }
        : {}),
      at: completedAt,
    };
    await ctx.db.insert("extractionPaperErrors", {
      paperId,
      jobId: paper.jobId,
      attempt,
      at: completedAt,
      code: extras.error.code,
      message: extras.error.message,
      ...(extras.error.context !== undefined ? { context: extras.error.context } : {}),
      ...(extras.error.httpStatus !== undefined ? { httpStatus: extras.error.httpStatus } : {}),
      ...(extras.error.providerName !== undefined
        ? { providerName: extras.error.providerName }
        : {}),
    });
  }

  await ctx.db.patch("extractionPapers", paperId, patch);
  await recomputePaperListProjection(ctx, paperId);

  // Tier B: per-job processed/failed counts now live in a sharded
  // counter (see ./jobCounters.ts). Two writers landing terminal
  // transitions for the same job almost always hit different shards,
  // so the P-way OCC retry storm on the singleton extractionJobs row
  // is gone. We also stop bumping `extractionJobs.updatedAt` on the
  // per-paper path — the workflow's `maybeFinalizeJob` write on the
  // final transition is the only updatedAt source from per-paper code
  // now, which is enough for "last activity" sort.
  if (paper.processable !== false) {
    await incPaperOutcome(ctx, paper.jobId, newStatus === "completed");
  }

  return { applied: true, paper };
}
