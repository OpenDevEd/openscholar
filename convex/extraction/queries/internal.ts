/**
 * Internal queries used by queue / workpool / cron handlers. Every
 * export here is an `internalQuery`; public readers live in the sibling
 * submodules. Gathering them in one file makes the internal surface
 * obvious at a glance and cheap to audit.
 *
 * Names intentionally keep the `*Internal` suffix for the non-debug
 * internals; after T5.13 they surface at
 * `internal.extraction.queries.internal.<fn>` and the suffix is
 * redundant, but renaming them would fan out across workpoolActions.ts
 * without adding value.
 */

import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { getFlag } from "../../featureFlags/guard";
import { userValidator } from "../../lib/validators";
import { getProcessableFlags } from "../content";
import { readJobSources } from "../jobSources";
import { MAX_EVIDENCE_UNITS_PER_PAPER } from "../../lib/queryBounds";
import { PAPER_LIMIT } from "@/lib/extraction/limits";
import {
  errorCodeValidator,
  extractionEvidenceUnitValidator,
  extractionJobValidator,
  extractionPaperValidator,
  extractionQuestionValidator,
  extractionResultValidator,
  jobSourcesReadValidator,
  jobStatusValidator,
  paperStatusValidator,
} from "../validators";

export const getJobInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(v.null(), extractionJobValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get("extractionJobs", args.jobId);
  },
});

export const getQuestionCount = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    return questions.length;
  },
});

/**
 * Lean control-plane read used by queue dispatchers and worker stale-run
 * guards. Returning just `{ status, runEpoch }` keeps the freshness read
 * cheap enough to repeat before dispatch and before persistence.
 */
export const getJobStatusInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    status: v.union(v.null(), jobStatusValidator),
    runEpoch: v.number(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    return {
      status: job?.status ?? null,
      runEpoch: job?.runEpoch ?? 0,
    };
  },
});

export const getJobSourcesInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: jobSourcesReadValidator,
  handler: async (ctx, args) => {
    return await readJobSources(ctx, args.jobId, PAPER_LIMIT * 2);
  },
});

// Combined read so workpool actions fetch job + effective pdfEnabled in
// one round trip. `pdfEnabled` is the EFFECTIVE flag: both the admin
// capability gate (`extraction.pdf`) AND the per-job opt-in
// (`job.usePdfs`) must be true. This keeps the AND logic in one place
// so every caller stays consistent.
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
    const flagOn = pdfFlag?.enabled ?? true;
    const jobOptedIn = job?.usePdfs ?? false;
    return {
      job,
      pdfEnabled: flagOn && jobOptedIn,
    };
  },
});

export const getPaperExtractionContext = internalQuery({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
  },
  returns: v.union(
    v.object({ status: v.literal("not_found") }),
    v.object({
      status: v.literal("ok"),
      job: extractionJobValidator,
      paper: extractionPaperValidator,
      user: v.union(v.null(), userValidator),
      pdfEnabled: v.boolean(),
      questions: v.array(extractionQuestionValidator),
      results: v.array(extractionResultValidator),
      evidenceUnits: v.array(extractionEvidenceUnitValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const [job, paper, pdfFlag] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.paperId),
      getFlag(ctx, "extraction.pdf"),
    ]);
    if (!job || !paper || paper.jobId !== args.jobId) {
      return { status: "not_found" as const };
    }

    const [user, questions, results, evidenceUnits] = await Promise.all([
      ctx.db.get("users", job.userId),
      ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .order("asc")
        .collect(),
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
        .collect(),
      ctx.db
        .query("extractionEvidenceUnits")
        .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
        .take(MAX_EVIDENCE_UNITS_PER_PAPER),
    ]);

    return {
      status: "ok" as const,
      job,
      paper,
      user,
      pdfEnabled: (pdfFlag?.enabled ?? true) && (job.usePdfs ?? false),
      questions,
      results,
      evidenceUnits,
    };
  },
});

/**
 * Plan-05 retry: load every `extractionResults` row for a job whose
 * status is "pending". Retained for internal retry/debug callers that
 * need to inspect reset rows after `retryFailedQuestions` runs.
 */
export const getPendingResultsInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(extractionResultValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionResults")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "pending"),
      )
      .collect();
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
    if (!job) return { totalPapers: 0, processedPapers: 0, failedPapers: 0 };

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT);
    const processablePapers = papers.filter((p) => p.processable !== false);
    const processed = processablePapers.filter(
      (p) => p.status === "completed",
    ).length;
    const failed = processablePapers.filter(
      (p) =>
        p.status === "failed" ||
        p.status === "download_failed" ||
        p.status === "indexing_failed",
    ).length;

    return {
      totalPapers: job.totalPapers || processablePapers.length,
      processedPapers: processed,
      failedPapers: failed,
    };
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
      lastErrorCode: v.optional(errorCodeValidator),
      lastErrorMessage: v.optional(v.string()),
      attemptCount: v.optional(v.number()),
      completedAt: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .order("desc")
      .take(10);

    return papers.map((p) => ({
      id: p._id,
      title: p.title.substring(0, 30),
      status: p.status,
      pdfUrl: !!p.pdfUrl,
      storageId: p.storageId,
      ragEntryId: p.ragEntryId,
      lastErrorCode: p.lastError?.code,
      lastErrorMessage: p.lastError?.message,
      attemptCount: p.attemptCount,
      completedAt: p.completedAt
        ? new Date(p.completedAt).toISOString()
        : null,
    }));
  },
});

// Debug query to surface per-paper content + status for a job. The
// return shape is v.any() on purpose — it's an assertNonProd-gated
// diagnostic that evolves with the extraction pipeline, and no prod
// caller inspects its shape.
export const getPapersDebug = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT);

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
