import { mutation } from "../_generated/server";
import { v } from "convex/values";
import {
  screeningPaperInputValidator,
  screeningQuestionValidator,
  screeningScoringConfigValidator,
} from "./validators";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";

/**
 * Create a bulk screening job.
 *
 * Validates paper count, checks credits, guards against concurrent active jobs,
 * creates the job record with embedded questions/scoring config, and inserts
 * pending result records for each paper.
 *
 * Note: Does NOT start a workflow -- that is wired in Phase 77.
 * The job stays in "pending" status until the workflow is connected.
 */
export const createScreeningJob = mutation({
  args: {
    papers: v.array(screeningPaperInputValidator),
    questions: v.array(screeningQuestionValidator),
    scoringConfig: screeningScoringConfigValidator,
    targetCollectionId: v.optional(v.id("collections")),
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, args) => {
    // 1. Authentication
    const user = await requireAuth(ctx);

    // 2. Validate paper count
    if (args.papers.length === 0) {
      throw createError(
        "VALIDATION_ERROR",
        "At least one paper is required"
      );
    }
    if (args.papers.length > MAX_SCREENING_PAPERS_PER_JOB) {
      throw createError(
        "VALIDATION_ERROR",
        `Cannot screen more than ${MAX_SCREENING_PAPERS_PER_JOB} papers per job`
      );
    }

    // 3. Check for active jobs (pending or processing)
    // Two separate queries per Pitfall 3 in RESEARCH.md (Convex cannot OR on index values)
    const pendingJob = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending")
      )
      .first();

    if (pendingJob) {
      throw createError(
        "SCREENING_JOB_ALREADY_ACTIVE",
        "You already have an active screening job"
      );
    }

    const processingJob = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "processing")
      )
      .first();

    if (processingJob) {
      throw createError(
        "SCREENING_JOB_ALREADY_ACTIVE",
        "You already have an active screening job"
      );
    }

    // 4. Credit pre-flight check
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const totalAvailable =
      (credits?.freeBalance ?? 0) + (credits?.paidBalance ?? 0);

    if (totalAvailable < args.papers.length) {
      throw createError(
        "INSUFFICIENT_CREDITS",
        `Need ${args.papers.length} credits but only have ${totalAvailable}`
      );
    }

    // 5. Create screening job record
    const now = Date.now();
    const jobId = await ctx.db.insert("screeningJobs", {
      userId: user._id,
      status: "pending",
      totalPapers: args.papers.length,
      processedPapers: 0,
      failedPapers: 0,
      qualifiedPapers: 0,
      questions: args.questions,
      scoringConfig: args.scoringConfig,
      targetCollectionId: args.targetCollectionId,
      createdAt: now,
      updatedAt: now,
    });

    // 6. Insert pending screening result records for each paper
    for (const paper of args.papers) {
      await ctx.db.insert("screeningResults", {
        jobId,
        openalexId: paper.openalexId,
        title: paper.title,
        abstract: paper.abstract,
        authors: paper.authors,
        publicationYear: paper.publicationYear,
        doi: paper.doi,
        status: "pending",
        createdAt: now,
      });
    }

    // 7. Return job ID
    return { jobId };
  },
});
