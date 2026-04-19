import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { workflow } from "../../workflow";
import { writeJobSources, type BucketItemInput } from "../jobSources";
import { assertNonProd } from "../../lib/assertNonProd";
import {
  bucketItemInputValidator,
  jobStatusValidator,
  questionInputValidator,
} from "../validators";

/**
 * Consolidated fixture helpers for dev/CI-only extraction tests.
 * Gated by `assertNonProd()` — prod invocations throw.
 */

type QuestionInput = {
  key: string;
  question: string;
  type: "string" | "boolean" | "number" | "array";
  description?: string;
};

const DEFAULT_QUESTIONS: QuestionInput[] = [
  { key: "q1", question: "What methodology was used?", type: "string" },
];

const DEFAULT_BUCKET_ITEMS: BucketItemInput[] = [
  {
    bucketKey: "history:test-history",
    source: "history",
    sourceRefId: "test-history",
    title: "machine learning education",
    authors: [],
    searchFilters: {
      query: "machine learning education",
      yearRange: [2015, 2024],
      sortBy: "relevance",
    },
  },
];

/**
 * Create a test extraction job. Supersedes the old `createTestJob` /
 * `createTestJobForFix` / `createAndRunTestJob` / `test_automation_internal.createTestJob`
 * variants. Set `start: true` to start the workflow after insertion.
 * When `userId` is omitted, the first user in the database is used.
 */
export const createTestJob = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    name: v.optional(v.string()),
    status: v.optional(jobStatusValidator),
    bucketItems: v.optional(v.array(bucketItemInputValidator)),
    questions: v.optional(v.array(questionInputValidator)),
    start: v.optional(v.boolean()),
  },
  returns: v.object({
    jobId: v.id("extractionJobs"),
    userId: v.id("users"),
  }),
  handler: async (ctx, args) => {
    assertNonProd();

    let userId: Id<"users"> | null = args.userId ?? null;
    if (!userId) {
      const user = await ctx.db.query("users").first();
      if (!user) throw new Error("No users found in database");
      userId = user._id;
    }

    const now = Date.now();
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: args.name ?? `PDF Test ${now}`,
      sourceType: "history",
      status: args.status ?? "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: now,
      updatedAt: now,
    });

    const bucketItems = args.bucketItems ?? DEFAULT_BUCKET_ITEMS;
    await writeJobSources(ctx, jobId, bucketItems);

    const questions = args.questions ?? DEFAULT_QUESTIONS;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: q.key,
        question: q.question,
        type: q.type,
        description: q.description,
        order: i,
        createdAt: now,
      });
    }

    if (args.start) {
      const workflowId = await workflow.start(
        ctx,
        internal.extraction.workflow.runExtractionWorkflow,
        { jobId },
        {
          onComplete:
            internal.extraction.mutations.internal.onComplete
              .handleExtractionJobComplete,
          context: { jobId },
        },
      );
      await ctx.db.patch(jobId, { workflowId, updatedAt: Date.now() });
    }

    return { jobId, userId };
  },
});

/**
 * Detailed status with per-paper sample results — powers the richer
 * `test_runner.getTestJobStatus` assertions.
 */
export const getTestJobStatus = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    jobStatus: v.optional(v.string()),
    totalPapers: v.number(),
    statusCounts: v.record(v.string(), v.number()),
    pdfUsedCount: v.number(),
    completedWithPdf: v.number(),
    sampleResults: v.array(
      v.object({
        paperId: v.id("extractionPapers"),
        title: v.string(),
        pdfUsed: v.boolean(),
        status: v.string(),
        results: v.array(
          v.object({
            questionKey: v.string(),
            answer: v.union(
              v.string(),
              v.boolean(),
              v.number(),
              v.array(v.string()),
              v.null(),
            ),
            confidence: v.optional(v.number()),
            pdfContentUsed: v.optional(v.boolean()),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, { jobId }) => {
    assertNonProd();
    const job = await ctx.db.get("extractionJobs", jobId);
    if (!job) throw new Error("Job not found");

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(500);

    const statusCounts: Record<string, number> = {};
    let pdfUsedCount = 0;
    let completedWithPdf = 0;
    for (const paper of papers) {
      statusCounts[paper.status] = (statusCounts[paper.status] || 0) + 1;
      const hasPdf = Boolean(paper.ragEntryId || paper.storageId);
      if (hasPdf) pdfUsedCount++;
      if (paper.status === "completed" && hasPdf) completedWithPdf++;
    }

    const completedPapers = papers
      .filter((p) => p.status === "completed")
      .slice(0, 3);
    const sampleResults: Array<{
      paperId: Id<"extractionPapers">;
      title: string;
      pdfUsed: boolean;
      status: string;
      results: Array<{
        questionKey: string;
        answer: string | boolean | number | string[] | null;
        confidence?: number;
        pdfContentUsed?: boolean;
      }>;
    }> = [];
    for (const paper of completedPapers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(50);
      sampleResults.push({
        paperId: paper._id,
        title: paper.title,
        pdfUsed: Boolean(paper.ragEntryId || paper.storageId),
        status: paper.status,
        results: results.map((r) => ({
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

/**
 * Lightweight aggregate counters — used by the PDF smoke-test polling loop.
 */
export const getTestJobResults = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    status: v.string(),
    total: v.number(),
    completed: v.number(),
    failed: v.number(),
    withPdf: v.number(),
    indexed: v.number(),
    pdfContentUsed: v.number(),
  }),
  handler: async (ctx, { jobId }) => {
    assertNonProd();
    const job = await ctx.db.get("extractionJobs", jobId);
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(500);

    const processable = papers.filter((p) => p.processable !== false);
    return {
      status: job?.status ?? "unknown",
      total: processable.length,
      completed: processable.filter((p) => p.status === "completed").length,
      failed: processable.filter(
        (p) => p.status === "failed" || p.status === "download_failed",
      ).length,
      withPdf: papers.filter((p) => p.ragEntryId || p.storageId).length,
      indexed: papers.filter((p) => p.isIndexed || p.ragEntryId).length,
      pdfContentUsed: papers.filter((p) => p.pdfContentUsed).length,
    };
  },
});
