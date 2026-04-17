/**
 * Job-results queries. Full-job read (getJobResults) for export, and
 * paginated read (getJobResultsPaginated) for the UI list. Both batch-load
 * reviews + results in two by_job reads instead of per-paper fan-out.
 */

import { query } from "../../_generated/server";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { MAX_PAPERS_PER_JOB } from "../../lib/queryBounds";
import {
  extractionJobValidator,
  extractionPaperValidator,
  extractionQuestionValidator,
  extractionResultWithReviewValidator,
  paginatedPaperWithResultsValidator,
} from "../validators";
import {
  applyReviewMetadata,
  loadResultsByJob,
  loadReviewsByJob,
} from "./_shared";

const paginatedPaperResultValidator = paginationResultValidator(
  paginatedPaperWithResultsValidator,
);

export const getJobResults = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    questions: v.array(extractionQuestionValidator),
    papers: v.record(
      v.string(),
      v.object({
        paper: extractionPaperValidator,
        results: v.array(extractionResultWithReviewValidator),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { job } = access;
    await requireFeature(ctx, "extraction.enabled");

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);

    const [reviewMap, resultsByPaper] = await Promise.all([
      loadReviewsByJob(ctx, args.jobId),
      loadResultsByJob(ctx, args.jobId),
    ]);

    const allResults: Record<
      string,
      { paper: Doc<"extractionPapers">; results: Doc<"extractionResults">[] }
    > = {};
    for (const paper of papers) {
      const rawResults = resultsByPaper.get(paper._id) ?? [];
      allResults[paper._id] = {
        paper,
        results: applyReviewMetadata(rawResults, reviewMap),
      };
    }

    return ok({
      job,
      questions,
      papers: allResults,
    });
  },
});

export const getJobResultsPaginated = query({
  args: {
    jobId: v.id("extractionJobs"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      ...paginatedPaperResultValidator.fields,
    }),
    v.object({
      status: v.union(v.literal("unauthenticated"), v.literal("no_access")),
      ...paginatedPaperResultValidator.fields,
    }),
  ),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return {
        status: access.status,
        page: [],
        isDone: true,
        continueCursor: "",
        splitCursor: null,
        pageStatus: null,
      };
    }
    await requireFeature(ctx, "extraction.enabled");

    // Paginate asc (oldest at top) so UI updates land at the top of the list.
    const result = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_processable", (q) =>
        q.eq("jobId", args.jobId).eq("processable", true),
      )
      .order("asc")
      .paginate(args.paginationOpts);

    const [reviewMap, resultsByPaper] = await Promise.all([
      loadReviewsByJob(ctx, args.jobId),
      loadResultsByJob(ctx, args.jobId),
    ]);

    const papersWithResults = result.page.map((paper) => {
      const rawResults = resultsByPaper.get(paper._id) ?? [];
      return {
        ...paper,
        results: applyReviewMetadata(rawResults, reviewMap),
      };
    });

    return {
      status: "ok" as const,
      ...result,
      page: papersWithResults,
    };
  },
});
