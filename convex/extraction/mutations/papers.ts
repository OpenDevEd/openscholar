/**
 * Extraction paper internal mutations.
 *
 * The queue setup and paper workers write each paper through these:
 * createPaperRecords saves each step of papers the setup reads, once per paper;
 * updatePaperStatus routes terminal transitions through markPaperTerminalTx
 * (shared with results.ts); setPaperStorage re-evaluates processable when a
 * PDF lands; markPaperIndexed flips isIndexed and deducts embedding credits
 * idempotently.
 */

import { internalMutation } from "../../lib/functions";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { getFlag } from "../../featureFlags/guard";
import { getProcessableFlags } from "../content";
import { errorCodeValidator, paperSourceTypeValidator, setupPlaceValidator } from "../validators";
import { buildDedupeKey } from "../dedupe";
import { isTerminalPaperStatus, markPaperTerminalTx } from "../paperLifecycle";
import { isRetryable, type ClassifiedError } from "@/lib/errors/taxonomy";
import { recomputePaperListProjection } from "../listProjection";
import { MAX_AUTHORS } from "../../lib/listCaps";
import { sourceMetadataFields } from "../../lib/paperMetadata";
import { sourceMetadata } from "../../../lib/library/paper-metadata";

function matchesExpectedEpoch(
  job: { runEpoch?: number } | null | undefined,
  expectedEpoch?: number,
): boolean {
  if (expectedEpoch === undefined) return true;
  return (job?.runEpoch ?? 0) === expectedEpoch;
}

/** A paper a setup step saves, as its source gave it. */
const setupPaperValidator = v.object({
  ...sourceMetadataFields,
  citedByCount: v.optional(v.number()),
  venueName: v.optional(v.string()),
  openalexId: v.string(),
  title: v.string(),
  doi: v.optional(v.string()),
  publicationYear: v.optional(v.number()),
  abstract: v.optional(v.string()),
  authors: v.optional(v.array(v.string())),
  storageId: v.optional(v.id("_storage")),
  sourceType: v.optional(paperSourceTypeValidator),
  sourceId: v.optional(v.string()),
  screeningRevision: v.optional(v.string()),
});

/**
 * Saves a step of a job's papers (#634). A paper another source already brought is saved
 * once, by its identity across sources, and a screening's copy takes the place of another
 * source's, as long as that copy hasn't run: it keeps the screened metadata and decision
 * provenance, and a screening copy the job can't read takes the other copy out too. With
 * `setup`, the step is part of the job's setup, and the job records where its setup goes on
 * from, with its papers counted, in the same transaction, so a step is never saved twice or
 * half. Its papers are queued once every source is read (../actions.ts), so a screening copy
 * read later still finds the other copy waiting.
 */
export const createPaperRecords = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    papers: v.array(setupPaperValidator),
    setup: v.optional(v.object({ expectedEpoch: v.number(), next: setupPlaceValidator })),
  },
  returns: v.object({ paperIds: v.array(v.id("extractionPapers")), processableCount: v.number() }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) return { paperIds: [], processableCount: 0 };
    // A setup step for a run that was cancelled, paused or restarted since saves nothing.
    if (args.setup && (job.runEpoch ?? 0) !== args.setup.expectedEpoch) return { paperIds: [], processableCount: 0 };
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;
    const paperIds: Array<Id<"extractionPapers">> = [];
    // How the step moved the job's papers, and its processable ones.
    let papers = 0;
    let processableCount = 0;
    for (const paper of args.papers) {
      const sanitizedPdfUrl = pdfEnabled ? paper.pdfUrl : undefined;
      const sanitizedStorageId = pdfEnabled ? paper.storageId : undefined;
      const { processable } = getProcessableFlags({
        pdfUrl: sanitizedPdfUrl,
        oaUrl: paper.oaUrl,
        storageId: sanitizedStorageId,
        abstract: paper.abstract,
        openalexId: paper.openalexId,
        doi: paper.doi,
        pdfEnabled,
      });
      // Without full texts, a paper with nothing to read isn't saved at all.
      const kept = pdfEnabled || processable;
      const dedupeKey = buildDedupeKey({ openalexId: paper.openalexId, doi: paper.doi, title: paper.title, year: paper.publicationYear });
      const existing = await ctx.db.query("extractionPapers").withIndex("by_job_dedupeKey", (q) => q.eq("jobId", args.jobId).eq("dedupeKey", dedupeKey)).first();
      if (existing) {
        // Only a screening's copy takes the place of another source's, before either has run.
        if (paper.sourceType !== "screening" || existing.sourceType === "screening" || existing.status !== "pending") continue;
        const wasProcessable = existing.processable === true;
        if (!kept) {
          await ctx.db.delete("extractionPapers", existing._id);
          papers -= 1;
          if (wasProcessable) processableCount -= 1;
          continue;
        }
        await ctx.db.patch("extractionPapers", existing._id, paperFields(paper, sanitizedStorageId, processable));
        await recomputePaperListProjection(ctx, existing._id);
        processableCount += Number(processable) - Number(wasProcessable);
        continue;
      }
      if (!kept) continue;
      const paperId = await ctx.db.insert("extractionPapers", { ...paperFields(paper, sanitizedStorageId, processable), jobId: args.jobId, dedupeKey, status: "pending" });
      paperIds.push(paperId);
      papers += 1;
      if (processable) processableCount += 1;
      await recomputePaperListProjection(ctx, paperId);
    }
    if (args.setup) {
      const { next } = args.setup;
      const processable = next.processable + processableCount;
      // The job's count goes up with its rows, a step at a time: a setup stopped part-way (cancelled between two steps)
      // leaves a job whose header, bar and exports count the papers it has (#822).
      await ctx.db.patch("extractionJobs", args.jobId, { setup: { ...next, papers: next.papers + papers, processable }, totalPapers: processable, updatedAt: Date.now() });
    }
    return { paperIds, processableCount };
  },
});

/** A saved paper's fields, as its source gave it. */
function paperFields(paper: Infer<typeof setupPaperValidator>, storageId: Id<"_storage"> | undefined, processable: boolean) {
  return {
    ...sourceMetadata(paper),
    citedByCount: paper.citedByCount,
    venueName: paper.venueName,
    openalexId: paper.openalexId,
    title: paper.title,
    doi: paper.doi,
    publicationYear: paper.publicationYear,
    abstract: paper.abstract,
    authors: paper.authors?.slice(0, MAX_AUTHORS),
    // The source's PDF address is kept whether or not full texts are read now.
    pdfUrl: paper.pdfUrl,
    storageId,
    isOpenAccess: paper.isOpenAccess,
    sourceType: paper.sourceType,
    sourceId: paper.sourceId,
    screeningRevision: paper.screeningRevision,
    processable,
  };
}

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
    await recomputePaperListProjection(ctx, args.paperId);
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
    await recomputePaperListProjection(ctx, args.paperId);
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
      oaUrl: paper.oaUrl,
      storageId: args.storageId,
      abstract: paper.abstract,
      openalexId: paper.openalexId,
      doi: paper.doi,
      pdfEnabled,
    });
    await ctx.db.patch("extractionPapers", args.paperId, {
      storageId: args.storageId,
      processable,
    });
    await recomputePaperListProjection(ctx, args.paperId);
    return null;
  },
});

export const markPaperIndexed = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    ragEntryId: v.optional(v.string()),
    expectedEpoch: v.optional(v.number()),
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

    await ctx.db.patch("extractionPapers", args.paperId, updates);
    await recomputePaperListProjection(ctx, args.paperId);
    return null;
  },
});
