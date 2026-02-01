/**
 * Extraction Queries
 * Queries for retrieving extraction job data
 */

import { query, internalQuery } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser, requireAuth } from "../lib/auth";

// Get user's extraction jobs (public API)
export const getMyJobs = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("downloading_pdfs"),
        v.literal("indexing"),
        v.literal("extracting"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // Handle unauthenticated gracefully
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    let jobs: Doc<"extractionJobs">[];
    if (args.status) {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", user._id).eq("status", args.status!)
        )
        .order("desc")
        .take(50);
    } else {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(50);
    }

    return jobs;
  },
});

// Get job details with progress (public API)
export const getJobDetails = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    // Handle unauthenticated gracefully
    // Handle unauthenticated gracefully
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);

    if (!job || job.userId !== user._id) {
      throw new Error("Job not found");
    }

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(100);

    return {
      job,
      questions,
      papers,
      progress: {
        total: job.totalPapers,
        processed: job.processedPapers,
        failed: job.failedPapers,
        percentage:
          job.totalPapers > 0
            ? Math.round(
                ((job.processedPapers + job.failedPapers) / job.totalPapers) * 100
              )
            : 0,
      },
    };
  },
});

// Get paper extraction results (public API)
export const getPaperResults = query({
  args: { paperId: v.id("extractionPapers") },
  handler: async (ctx, args) => {
    // Handle unauthenticated gracefully
    // Handle unauthenticated gracefully
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const paper = await ctx.db.get(args.paperId);
    if (!paper) throw new Error("Paper not found");

    const job = await ctx.db.get(paper.jobId);
    if (!job || job.userId !== user._id) {
      throw new Error("Unauthorized Access");
    }

    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    return { paper, results };
  },
});

// Get all results for a job (public API) - for export
export const getJobResults = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    // Handle unauthenticated gracefully
    // Handle unauthenticated gracefully
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw new Error("Job not found");
    }

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    // Get all results for all papers
    const allResults: Record<
      string,
      { paper: Doc<"extractionPapers">; results: Doc<"extractionResults">[] }
    > = {};

    for (const paper of papers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();

      allResults[paper._id] = {
        paper,
        results,
      };
    }

    return {
      job,
      questions,
      papers: allResults,
    };
  },
});

// Get paginated results for a job
export const getJobResultsPaginated = query({
  args: {
    jobId: v.id("extractionJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Handle unauthenticated gracefully
    // Handle unauthenticated gracefully
    const user = await getCurrentUser(ctx);
    if (!user) {
        return {
            page: [],
            isDone: false,
            continueCursor: "",
            questions: [],
            job: null as any
        };
    }

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw new Error("Job not found");
    }

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const result = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      //.order("desc") // User wants oldest (processing) first? Or if FIFO queue. 
      // If user said "scroll to bottom to see updates" and it WAS desc, then updates were at bottom -> Oldest were at bottom.
      // So FIFO processing matches desc list having updates at bottom.
      // To see updates at TOP, we need ASC (Oldest at top).
      .order("asc") 
      .paginate(args.paginationOpts);

    const papersWithResults = await Promise.all(
      result.page.map(async (paper) => {
        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
          .collect();
        return {
          ...paper,
          results,
        };
      })
    );

    return {
      ...result,
      page: papersWithResults,
      questions,
      job,
    };
  },
});

// Internal queries (called by workflow/actions)

export const getJobInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const debugRecentPapers = internalQuery({
  args: {},
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
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();
  },
});

export const getPapersByOpenAlexIds = internalQuery({
  args: {
    jobId: v.id("extractionJobs"),
    openalexIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    // Filter by OpenAlex IDs
    return papers.filter((p) => args.openalexIds.includes(p.openalexId));
  },
});

export const getPaperInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paperId);
  },
});

export const getJobProgressInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return { totalPapers: 0, processedPapers: 0, failedPapers: 0 };
    }

    return {
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
    };
  },
});

// Debug query to get all papers for a job with their statuses
export const getPapersDebug = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const statusCounts: Record<string, number> = {};
    const pendingPapers = [];
    const papersWithWorkIds = [];

    for (const paper of papers) {
      statusCounts[paper.status] = (statusCounts[paper.status] || 0) + 1;
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
      pendingPapers: pendingPapers.slice(0, 20),
      papersWithWorkIds: papersWithWorkIds.slice(0, 20),
      samplePaper: papers[0] || null,
    };
  },
});

// Subscribe to job progress (real-time updates)
export const subscribeToJobProgress = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    // Handle unauthenticated gracefully
    // Handle unauthenticated gracefully
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw new Error("Job not found");
    }

    // Get status counts
    const allPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const statusCounts = {
      pending: 0,
      downloading: 0,
      download_failed: 0,
      indexing: 0,
      indexing_failed: 0,
      extracting: 0,
      completed: 0,
      failed: 0,
    };

    for (const paper of allPapers) {
      const status = paper.status as keyof typeof statusCounts;
      if (status in statusCounts) {
        statusCounts[status]++;
      }
    }

    return {
      job,
      statusCounts,
      recentPapers: allPapers.slice(-20), // Last 20 updated
    };
  },
});

// Get current user for actions
export const getCurrentUserInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    
    return await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();
  },
});
