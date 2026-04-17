/**
 * Extraction Queries
 * Queries for retrieving extraction job data
 */

import { query, internalQuery } from "../_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { notFound, ok } from "../lib/query_states";
import { resolveOwnedJob, resolveOwnedPaper } from "./access";
import { getProcessableFlags } from "./content";
import { requireFeature, getFlag } from "../featureFlags/guard";
import {
  aggregateQuestionInsights,
  buildArrayAnswerProfileClusters,
  buildDisagreementClusters,
  type DisagreementCluster,
  type InsightEntry,
  type QuestionType,
  type ReviewState,
} from "../../lib/extraction/insights";
import {
  MAX_EXTRACTION_JOBS_PER_USER,
  MAX_EVIDENCE_UNITS_PER_PAPER,
  MAX_PAPERS_PER_JOB,
} from "../lib/queryBounds";
import {
  extractionEvidenceUnitValidator,
  extractionJobValidator,
  extractionQuestionValidator,
  extractionPaperValidator,
  extractionResultValidator,
  extractionResultWithReviewValidator,
  extractionSavedViewValidator,
  extractionReportSnapshotValidator,
  extractionRunDiffValidator,
  questionTypeValidator,
  citationStatusValidator,
  reviewStateValidator,
  answerValidator,
  jobSourcesReadValidator,
  paperStatusValidator,
  paginatedPaperWithResultsValidator,
  workflowTemplateValidator,
} from "./validators";
import { statusResultValidator } from "../lib/query_states";
import { readJobSources } from "./jobSources";
import {
  applyReviewMetadata,
  attachReviewMetadata,
  buildQuestionInfoByKey,
  hasUsableAbstract,
  hasUsablePdfSource,
  loadJobPapersAndResults,
  loadResultsByJob,
  loadReviewsByJob,
  toCitationStatus,
  toReviewState,
} from "./queries/_shared";

const paginatedPaperResultValidator = paginationResultValidator(paginatedPaperWithResultsValidator);

export { getMyJobs, getJobDetails, subscribeToJobProgress } from "./queries/jobs";
export { getJobResults, getJobResultsPaginated } from "./queries/results";
export {
  getJobInsights,
  getQuestionInsights,
  getQuestionDisagreements,
} from "./queries/insights";
export { getReviewQueue } from "./queries/reviews";
export { getSavedViews } from "./queries/views";
export { getWorkflowTemplates } from "./queries/templates";
export { getReportSnapshots, getRunDiff } from "./queries/reports";

export const getPdfExtractionEnabledInternal = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    return pdfFlag?.enabled ?? true;
  },
});


// Get all results for a job (public API) - for export



// Internal queries (called by workflow/actions)

export const getJobInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(v.null(), extractionJobValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get("extractionJobs", args.jobId);
  },
});

export const debugRecentPapers = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("extractionPapers"),
      title: v.string(),
      status: paperStatusValidator,
      pdfUrl: v.boolean(),
      storageId: v.optional(v.id("_storage")),
      ragEntryId: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      completedAt: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const papers = await ctx.db.query("extractionPapers")
      .order("desc")
      .take(10);

    return papers.map(p => ({
      id: p._id,
      title: p.title.substring(0, 30),
      status: p.status,
      pdfUrl: !!p.pdfUrl,
      storageId: p.storageId,
      ragEntryId: p.ragEntryId,
      errorMessage: p.errorMessage,
      completedAt: p.completedAt ? new Date(p.completedAt).toISOString() : null
    }));
  }
});

export const getQuestionsInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(extractionQuestionValidator),
  handler: async (ctx, args) => {
    // Cardinality: ~5-20 questions per extraction job
    return await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();
  },
});

export const getJobSourcesInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: jobSourcesReadValidator,
  handler: async (ctx, args) => {
    return await readJobSources(ctx, args.jobId, MAX_PAPERS_PER_JOB * 2);
  },
});

// Combined read so the workpool actions fetch job + pdfEnabled in one
// round trip instead of two at the top of downloadAndIndexPdfAction and
// waitAndExtractAction.
export const getJobAndFlagsInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    job: v.union(v.null(), extractionJobValidator),
    pdfEnabled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const [job, pdfFlag] = await Promise.all([
      ctx.db.get("extractionJobs", args.jobId),
      getFlag(ctx, "extraction.pdf"),
    ]);
    return {
      job,
      pdfEnabled: pdfFlag?.enabled ?? true,
    };
  },
});


export const getEvidenceUnitsInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  returns: v.array(extractionEvidenceUnitValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionEvidenceUnits")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .take(MAX_EVIDENCE_UNITS_PER_PAPER);
  },
});

export const getJobProgressInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) {
      return { totalPapers: 0, processedPapers: 0, failedPapers: 0 };
    }

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);
    const processablePapers = papers.filter((p) => p.processable !== false);
    const processed = processablePapers.filter((p) => p.status === "completed").length;
    const failed = processablePapers.filter(
      (p) =>
        p.status === "failed" ||
        p.status === "download_failed" ||
        p.status === "indexing_failed"
    ).length;

    return {
      totalPapers: job.totalPapers || processablePapers.length,
      processedPapers: processed,
      failedPapers: failed,
    };
  },
});

// Debug query to get all papers for a job with their statuses
export const getPapersDebug = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  // v.any() on the return shape is intentional: this is a dev-only
  // diagnostic that surfaces an evolving, deeply-nested per-paper
  // snapshot (processable flags, content counts, workId lists). Every
  // caller is an assertNonProd-gated debug path; investing in a precise
  // validator would be churn-heavy with no prod consumer.
  returns: v.any(),
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);

    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;

    const statusCounts: Record<string, number> = {};
    const contentCounts = {
      total: papers.length,
      processable: 0,
      hasPdfUrl: 0,
      hasAbstract: 0,
      abstractOnly: 0,
      pdfOnly: 0,
      pdfAndAbstract: 0,
    };
    const pendingPapers = [];
    const papersWithWorkIds = [];

    for (const paper of papers) {
      statusCounts[paper.status] = (statusCounts[paper.status] || 0) + 1;
      const { hasPdfUrl, hasAbstract } = getProcessableFlags({
        pdfUrl: paper.pdfUrl,
        storageId: paper.storageId,
        abstract: paper.abstract,
        pdfEnabled,
      });
      const isProcessable = paper.processable !== false;

      if (hasPdfUrl) contentCounts.hasPdfUrl++;
      if (hasAbstract) contentCounts.hasAbstract++;
      if (hasPdfUrl && hasAbstract) contentCounts.pdfAndAbstract++;
      if (hasPdfUrl && !hasAbstract) contentCounts.pdfOnly++;
      if (!hasPdfUrl && hasAbstract) contentCounts.abstractOnly++;
      if (isProcessable) contentCounts.processable++;

      if (paper.status === "pending") {
        pendingPapers.push({
          id: paper._id,
          openalexId: paper.openalexId,
          title: paper.title,
          pdfUrl: paper.pdfUrl,
          workId: paper.workId,
        });
      }
      if (paper.workId) {
        papersWithWorkIds.push({
          id: paper._id,
          status: paper.status,
          workId: paper.workId,
        });
      }
    }

    return {
      totalPapers: papers.length,
      statusCounts,
      contentCounts,
      pendingPapers: pendingPapers.slice(0, 20),
      papersWithWorkIds: papersWithWorkIds.slice(0, 20),
      samplePaper: papers[0] || null,
    };
  },
});

// Subscribe to job progress (real-time updates).
// Reads only the `extractionJobs` row and returns a constant-size payload.
// Every terminal paper transition already bumps processedPapers/failedPapers
// on the job doc (see markPaperTerminalTx in mutations.ts), so Convex
// reactivity notices exactly one doc-change per transition instead of
// replaying the full paper set to every subscribed tab.
