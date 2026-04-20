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
import type { Doc } from "../../_generated/dataModel";
import { getFlag } from "../../featureFlags/guard";
import { getProcessableFlags } from "../content";
import { errorCodeValidator, paperSourceTypeValidator } from "../validators";
import { isTerminalPaperStatus, markPaperTerminalTx } from "../paperLifecycle";
import { recordCreditSpend } from "../aggregates";
import { isRetryable, type ClassifiedError } from "@/lib/errors/taxonomy";

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
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;
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

      await ctx.db.insert("extractionPapers", {
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
    }
    return null;
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
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
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
    return null;
  },
});

export const setPaperStorage = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;
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
    return null;
  },
});

export const markPaperIndexed = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    ragEntryId: v.optional(v.string()),
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
      const now = Date.now();
      await ctx.runMutation(internal.credits.internal.deductCredits, {
        userId: args.billing.userId,
        amount: args.billing.creditsToDeduct,
        description: "AI: Extraction embedding index",
        metadata: {
          billingType: "extraction_embedding",
          paperId: String(args.paperId),
          jobId: String(args.billing.jobId),
          embeddingTokens: String(args.billing.embeddingTokens),
        },
      });
      // Same-txn spend mirror for creditsAgg. Id is `embed:<paperId>`
      // because the aggregate mixes extraction_llm (keyed by resultId)
      // and embedding (keyed by paperId) entries in the same namespace;
      // prefixing keeps them collision-free.
      await recordCreditSpend(ctx, {
        jobId: args.billing.jobId,
        key: now,
        id: `embed:${args.paperId}`,
        creditsUsed: args.billing.creditsToDeduct,
      });
      updates.indexingBilled = true;
    }

    await ctx.db.patch("extractionPapers", args.paperId, updates);
    return null;
  },
});
