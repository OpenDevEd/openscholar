/**
 * Extraction paper internal mutations.
 *
 * The workflow writes each paper through these: createPaperRecords bulk-
 * inserts rows as the source fetcher yields them; updatePaperStatus
 * routes terminal transitions through markPaperTerminalTx (shared with
 * results.ts + onComplete.ts); setPaperStorage re-evaluates processable
 * when a PDF lands; markPaperIndexed flips isIndexed and deducts
 * embedding credits idempotently.
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { getFlag } from "../../featureFlags/guard";
import { getProcessableFlags } from "../content";
import { errorCodeValidator, paperSourceTypeValidator } from "../validators";
import { isTerminalPaperStatus, markPaperTerminalTx } from "../paperLifecycle";
import { recordCreditSpend } from "../aggregates";
import { isRetryable, type ClassifiedError } from "@/lib/errors/taxonomy";
import { refreshPaperListProjection } from "../listProjection";

function matchesExpectedEpoch(
  job: { runEpoch?: number } | null | undefined,
  expectedEpoch?: number,
): boolean {
  if (expectedEpoch === undefined) return true;
  return (job?.runEpoch ?? 0) === expectedEpoch;
}

export const createPaperRecords = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    papers: v.array(
      v.object({
        openalexId: v.string(),
        title: v.string(),
        doi: v.optional(v.string()),
        publicationYear: v.optional(v.number()),
        abstract: v.optional(v.string()),
        authors: v.optional(v.array(v.string())),
        pdfUrl: v.optional(v.string()),
        storageId: v.optional(v.id("_storage")),
        isOpenAccess: v.optional(v.boolean()),
        sourceType: v.optional(paperSourceTypeValidator),
        sourceId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    paperIds: v.array(v.id("extractionPapers")),
    processableCount: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    paperIds: Array<Id<"extractionPapers">>;
    processableCount: number;
  }> => {
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;
    const paperIds: Array<Id<"extractionPapers">> = [];
    let processableCount = 0;
    for (const paper of args.papers) {
      const sanitizedPdfUrl = pdfEnabled ? paper.pdfUrl : undefined;
      const sanitizedStorageId = pdfEnabled ? paper.storageId : undefined;
      const { processable } = getProcessableFlags({
        pdfUrl: sanitizedPdfUrl,
        storageId: sanitizedStorageId,
        abstract: paper.abstract,
        pdfEnabled,
      });

      if (!pdfEnabled && !processable) {
        continue;
      }

      const paperId = await ctx.db.insert("extractionPapers", {
        jobId: args.jobId,
        openalexId: paper.openalexId,
        title: paper.title,
        doi: paper.doi,
        publicationYear: paper.publicationYear,
        abstract: paper.abstract,
        authors: paper.authors,
        pdfUrl: sanitizedPdfUrl,
        storageId: sanitizedStorageId,
        isOpenAccess: paper.isOpenAccess,
        sourceType: paper.sourceType,
        sourceId: paper.sourceId,
        processable,
        status: "pending",
      });
      paperIds.push(paperId);
      if (processable) processableCount += 1;
      await refreshPaperListProjection(ctx, paperId);
    }
    return { paperIds, processableCount };
  },
});

export const updatePaperStatus = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    status: v.union(
      v.literal("pending"),
      v.literal("downloading"),
      v.literal("download_failed"),
      v.literal("indexing"),
      v.literal("indexing_failed"),
      v.literal("extracting"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    error: v.optional(
      v.object({
        code: errorCodeValidator,
        message: v.string(),
      }),
    ),
    completedAt: v.optional(v.number()),
    creditsUsed: v.optional(v.number()),
    expectedEpoch: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;
    const job = await ctx.db.get("extractionJobs", paper.jobId);
    if (!matchesExpectedEpoch(job, args.expectedEpoch)) return null;

    const classified: ClassifiedError | undefined = args.error
      ? {
          code: args.error.code,
          message: args.error.message,
          retryable: isRetryable[args.error.code],
        }
      : undefined;

    // Route terminal transitions through markPaperTerminalTx so the per-job
    // counter, lastError, attemptCount, and history-table insert all happen
    // atomically.
    if (isTerminalPaperStatus(args.status)) {
      await markPaperTerminalTx(ctx, args.paperId, args.status, {
        error: classified,
        completedAt: args.completedAt,
        creditsUsed: args.creditsUsed,
      });
      return null;
    }

    const updates: Record<string, unknown> = { status: args.status };
    if (args.completedAt !== undefined) {
      updates.completedAt = args.completedAt;
    }
    if (args.creditsUsed !== undefined) {
      updates.creditsUsed = args.creditsUsed;
    }

    await ctx.db.patch("extractionPapers", args.paperId, updates);
    await refreshPaperListProjection(ctx, args.paperId);
    return null;
  },
});

export const updatePaperProcessable = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    processable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch("extractionPapers", args.paperId, {
      processable: args.processable,
    });
    await refreshPaperListProjection(ctx, args.paperId);
    return null;
  },
});

export const setPaperStorage = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    storageId: v.id("_storage"),
    expectedEpoch: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;
    const job = await ctx.db.get("extractionJobs", paper.jobId);
    if (!matchesExpectedEpoch(job, args.expectedEpoch)) return null;
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;
    const { processable } = getProcessableFlags({
      pdfUrl: paper.pdfUrl,
      storageId: args.storageId,
      abstract: paper.abstract,
      pdfEnabled,
    });
    await ctx.db.patch("extractionPapers", args.paperId, {
      storageId: args.storageId,
      processable,
    });
    await refreshPaperListProjection(ctx, args.paperId);
    return null;
  },
});

export const markPaperIndexed = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    ragEntryId: v.optional(v.string()),
    expectedEpoch: v.optional(v.number()),
    // When provided, the embedding credits are deducted atomically with the
    // isIndexed flip. Gated on indexingBilled so a workpool retry that
    // replays the entire indexing action cannot re-charge the user.
    billing: v.optional(
      v.object({
        userId: v.id("users"),
        jobId: v.id("extractionJobs"),
        creditsToDeduct: v.number(),
        embeddingTokens: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;
    const job = await ctx.db.get("extractionJobs", paper.jobId);
    if (!matchesExpectedEpoch(job, args.expectedEpoch)) return null;

    const updates: Partial<Doc<"extractionPapers">> = {
      isIndexed: true,
      indexedAt: Date.now(),
    };

    if (args.ragEntryId) {
      updates.ragEntryId = args.ragEntryId;
    }

    if (
      args.billing &&
      !paper.indexingBilled &&
      args.billing.creditsToDeduct > 0
    ) {
      // allowPartial:true — embedding succeeded; any in-flight overrun
      // drains the wallet rather than leaving the index unbilled.
      // indexingBilled flips regardless of partial because the embedding
      // ran — we don't want to retry the embedding when the wallet
      // simply couldn't pay in full.
      const { deducted } = await ctx.runMutation(internal.credits.internal.deductCredits, {
        userId: args.billing.userId,
        amount: args.billing.creditsToDeduct,
        description: "AI: Extraction embedding index",
        jobId: args.billing.jobId,
        paperId: args.paperId,
        billingType: "embedding",
        metadata: {
          embeddingTokens: String(args.billing.embeddingTokens),
        },
        allowPartial: true,
      });
      // Same-txn spend mirror for creditsAgg. Id is `embed:<paperId>`
      // because the aggregate mixes extraction_llm (keyed by resultId)
      // and embedding (keyed by paperId) entries in the same namespace;
      // prefixing keeps them collision-free. Skip when deducted is 0
      // so we don't write zero-amount aggregator entries.
      if (deducted > 0) {
        await recordCreditSpend(ctx, {
          jobId: args.billing.jobId,
          id: `embed:${args.paperId}`,
          creditsUsed: deducted,
        });
      }
      updates.indexingBilled = true;
    }

    await ctx.db.patch("extractionPapers", args.paperId, updates);
    await refreshPaperListProjection(ctx, args.paperId);
    return null;
  },
});
