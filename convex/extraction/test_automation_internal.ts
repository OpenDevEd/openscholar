import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

// Get first user ID
export const getFirstUserId = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"users"> | null> => {
    const user = await ctx.db.query("users").first();
    return user?._id || null;
  },
});

// Create test job
export const createTestJob = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Id<"extractionJobs">> => {
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      name: `PDF Test ${Date.now()}`,
      sourceType: "history",
      searchFilters: {
        query: "desert climate africa",
        yearRange: [2015, 2024],
        sortBy: "relevance",
      },
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    // Add questions
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "method",
      question: "What methodology was used?",
      type: "string",
      order: 0,
      createdAt: Date.now(),
    });
    
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "sample",
      question: "What was the sample size?",
      type: "string",
      order: 1,
      createdAt: Date.now(),
    });
    
    return jobId;
  },
});

// Get job status  
export const getJobStatus = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    
    return {
      status: job?.status || "unknown",
      total: papers.length,
      completed: papers.filter((p) => p.status === "completed").length,
      withPdf: papers.filter((p) => p.ragEntryId || p.storageId).length,
    };
  },
});

// Get job results
export const getJobResults = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    
    const completed = papers.filter((p) => p.status === "completed");
    const withPdf = papers.filter((p) => p.ragEntryId || p.storageId);
    
    return {
      total: papers.length,
      completed: completed.length,
      failed: papers.filter((p) => p.status === "failed" || p.status === "download_failed").length,
      withPdf: withPdf.length,
    };
  },
});
