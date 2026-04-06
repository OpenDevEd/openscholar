import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { workflow } from "../workflow";

/**
 * Internal mutation to create and immediately start a test extraction job.
 * Bypasses authentication for testing purposes.
 *
 * Access: Internal only (internalMutation) -- not exposed to clients.
 */
export const createAndRunTestJob = internalMutation({
  args: {
    name: v.string(),
    query: v.optional(v.string()),
    paperLimit: v.optional(v.number()),
  },
  returns: v.object({
    jobId: v.id("extractionJobs"),
    message: v.string(),
    userId: v.id("users"),
  }),
  handler: async (ctx, args) => {
    // Get first user
    const user = await ctx.db
      .query("users")
      .first();
    
    if (!user) {
      throw new Error("No users found in database");
    }
    
    console.log(`[createAndRunTestJob] Creating job for user: ${user._id}`);
    
    // Create job
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      name: args.name,
      sourceType: "history",
      searchFilters: {
        query: args.query || "desert climate north africa",
        yearRange: [2000, 2024],
        sortBy: "relevance",
      },
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    console.log(`[createAndRunTestJob] Created job: ${jobId}`);
    
    // Add test questions
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "methodology",
      question: "What methodology was used in this study?",
      type: "string",
      order: 0,
      createdAt: Date.now(),
    });
    
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "sample_size",
      question: "What was the sample size?",
      type: "string",
      order: 1,
      createdAt: Date.now(),
    });
    
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "has_data",
      question: "Does the paper contain quantitative data?",
      type: "boolean",
      order: 2,
      createdAt: Date.now(),
    });
    
    console.log(`[createAndRunTestJob] Added 3 questions`);
    
    // Start the workflow
    try {
      const workflowId = await workflow.start(
        ctx,
        internal.extraction.workflow.runExtractionWorkflow,
        { jobId }
      );
      
      // Update job with workflow ID
      await ctx.db.patch("extractionJobs", jobId, { 
        workflowId,
        updatedAt: Date.now(),
      });
      
      console.log(`[createAndRunTestJob] Started workflow: ${workflowId} for job: ${jobId}`);
    } catch (error) {
      console.error(`[createAndRunTestJob] Failed to start workflow: ${error}`);
      throw error;
    }
    
    return { 
      jobId, 
      message: "Test job created and started",
      userId: user._id
    };
  },
});

/**
 * Internal mutation to check the status of a test extraction job.
 *
 * Access: Internal only (internalMutation) -- not exposed to clients.
 */
export const getTestJobStatus = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  returns: v.object({
    jobStatus: v.string(),
    totalPapers: v.number(),
    statusCounts: v.record(v.string(), v.number()),
    pdfUsedCount: v.number(),
    completedWithPdf: v.number(),
    sampleResults: v.array(v.object({
      paperId: v.id("extractionPapers"),
      title: v.string(),
      pdfUsed: v.boolean(),
      status: v.string(),
      results: v.array(v.object({
        questionKey: v.string(),
        answer: v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()),
        confidence: v.optional(v.number()),
        pdfContentUsed: v.optional(v.boolean()),
      })),
    })),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) {
      throw new Error("Job not found");
    }
    
    // Get papers
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    
    // Count by status
    const statusCounts: Record<string, number> = {};
    let pdfUsedCount = 0;
    let completedWithPdf = 0;
    
    for (const paper of papers) {
      statusCounts[paper.status] = (statusCounts[paper.status] || 0) + 1;
      if (paper.ragEntryId || paper.storageId) {
        pdfUsedCount++;
      }
      if (paper.status === "completed" && (paper.ragEntryId || paper.storageId)) {
        completedWithPdf++;
      }
    }
    
    // Get sample results
    const completedPapers = papers.filter(p => p.status === "completed").slice(0, 3);
    const sampleResults = [];
    
    for (const paper of completedPapers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();
      
      sampleResults.push({
        paperId: paper._id,
        title: paper.title,
        pdfUsed: !!(paper.ragEntryId || paper.storageId),
        status: paper.status,
        results: results.map(r => ({
          questionKey: r.questionKey,
          answer: r.answer,
          confidence: r.confidence,
          pdfContentUsed: r.pdfContentUsed,
        })),
      });
    }
    
    return {
      jobStatus: job.status,
      totalPapers: papers.length,
      statusCounts,
      pdfUsedCount,
      completedWithPdf,
      sampleResults,
    };
  },
});
