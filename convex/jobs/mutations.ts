/**
 * Universal Job System - Core Mutations
 *
 * Handles job creation, item claiming/releasing, cancellation, and retry.
 * Uses atomic operations to prevent race conditions and ensure correctness.
 */
import { internalMutation, mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel";
import {
  jobTypeValidator,
  jobStatusValidator,
  itemStatusValidator,
  jobItemPayloadValidator,
  claimResultValidator,
  releaseResultValidator,
  JOB_DEFAULTS,
  type JobType,
  type JobItemPayload,
  type ClaimResult,
  type ReleaseResult,
} from "./types";

// Type aliases for cleaner code
type Job = Doc<"jobs">;
type JobItem = Doc<"jobItems">;
type Analysis = Doc<"analyses">;
type Document = Doc<"documents">;
type ExtractionResult = Doc<"extractionResults">;

// ═══════════════════════════════════════════════════════════════════════════
// JOB CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new job with items.
 * Spawns initial workers if job has no dependencies.
 */
export const createJob = internalMutation({
  args: {
    type: jobTypeValidator,
    analysisId: v.id("analyses"),
    userId: v.optional(v.id("users")),
    items: v.array(jobItemPayloadValidator),
    concurrencyLimit: v.optional(v.number()),
    itemTimeoutMs: v.optional(v.number()),
    jobTimeoutMs: v.optional(v.number()),
    maxAttempts: v.optional(v.number()),
    dependsOn: v.optional(v.id("jobs")),
    chainId: v.optional(v.string()),
    chainPosition: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const defaults = JOB_DEFAULTS[args.type as JobType];

    // Determine initial status based on dependencies
    const hasDependency = args.dependsOn !== undefined;
    let initialStatus: "pending" | "running" = "running";

    if (hasDependency) {
      // Check if dependency is completed
      const parentJob = await ctx.db.get(args.dependsOn!);
      if (parentJob?.status !== "completed") {
        initialStatus = "pending";
      }
    }

    // Create the job
    const jobId = await ctx.db.insert("jobs", {
      type: args.type,
      analysisId: args.analysisId,
      userId: args.userId,
      status: initialStatus,
      concurrencyLimit: args.concurrencyLimit ?? defaults.concurrencyLimit,
      itemTimeoutMs: args.itemTimeoutMs ?? defaults.itemTimeoutMs,
      jobTimeoutMs: args.jobTimeoutMs ?? defaults.jobTimeoutMs,
      maxAttempts: args.maxAttempts ?? defaults.maxAttempts,
      totalItems: args.items.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      dependsOn: args.dependsOn,
      chainId: args.chainId,
      chainPosition: args.chainPosition,
      startedAt: now,
      lastActivityAt: now,
      metadata: args.metadata,
      errors: [],
    });

    // Create job items in batches to avoid transaction limits
    for (let i = 0; i < args.items.length; i++) {
      await ctx.db.insert("jobItems", {
        jobId,
        index: i,
        status: "pending",
        payload: args.items[i],
        attempts: 0,
      });
    }

    // Spawn initial workers if job is running and has items
    if (initialStatus === "running" && args.items.length > 0) {
      const workers = Math.min(
        args.concurrencyLimit ?? defaults.concurrencyLimit,
        args.items.length
      );
      for (let i = 0; i < workers; i++) {
        await ctx.scheduler.runAfter(
          i * 50,
          internal.jobs.actions.processNextItem,
          { jobId }
        );
      }
    }
    
    // Handle 0-item jobs that should run immediately - auto-complete them
    if (initialStatus === "running" && args.items.length === 0) {
      console.log(`[Jobs] Job ${jobId} (${args.type}) created with 0 items - auto-completing`);
      await ctx.db.patch(jobId, {
        status: "completed",
        completedAt: now,
      });
      // Note: startDependentJobs will be called by the next query of this job
      // We schedule it to run after this mutation completes
      await ctx.scheduler.runAfter(0, internal.jobs.mutations.triggerDependentJobs, {
        jobId,
      });
    }

    return jobId;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ITEM CLAIMING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Claim the next available item for processing.
 * Handles stale item recovery and concurrency limits.
 *
 * Returns:
 * - null: No work available or job complete
 * - {waitAndRetry: true}: At capacity, worker should wait and retry
 * - {item details}: Successfully claimed an item
 */
export const claimItem = internalMutation({
  args: {
    jobId: v.id("jobs"),
  },
  returns: claimResultValidator,
  handler: async (ctx, { jobId }): Promise<ClaimResult> => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    // Job not running - no work
    if (job.status !== "running") {
      return null;
    }

    const now = Date.now();

    // Check job timeout
    if (now - job.startedAt > job.jobTimeoutMs) {
      await ctx.db.patch(jobId, {
        status: "failed",
        completedAt: now,
        errors: [
          ...job.errors.slice(-99),
          `Job timed out after ${job.jobTimeoutMs}ms`,
        ],
      });
      return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Check for stale claimed items (crash recovery)
    // ═══════════════════════════════════════════════════════════════

    const claimedItems = await ctx.db
      .query("jobItems")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "claimed")
      )
      .collect();

    // Find stale items
    for (const item of claimedItems) {
      const claimedAt = item.claimedAt ?? 0;
      if (now - claimedAt > job.itemTimeoutMs) {
        // Item is stale
        if (item.attempts >= job.maxAttempts) {
          // Exceeded max attempts - mark as permanently failed
          await ctx.db.patch(item._id, {
            status: "failed",
            completedAt: now,
            error: `Exceeded max attempts (${job.maxAttempts}) due to worker timeout`,
          });
          await ctx.db.patch(jobId, {
            processed: job.processed + 1,
            failed: job.failed + 1,
            lastActivityAt: now,
            errors: [
              ...job.errors.slice(-99),
              `Item ${item.index} failed after ${job.maxAttempts} attempts (timeout)`,
            ],
          });
          // Refresh job data
          const updatedJob = await ctx.db.get(jobId);
          if (updatedJob) {
            await checkJobCompletion(ctx, updatedJob);
          }
        } else {
          // Reclaim for retry
          await ctx.db.patch(item._id, {
            status: "claimed",
            claimedAt: now,
            attempts: item.attempts + 1,
          });
          await ctx.db.patch(jobId, { lastActivityAt: now });

          console.log(
            `[Jobs] Recovering stale item ${item.index} (attempt ${item.attempts + 1}/${job.maxAttempts})`
          );

          return {
            waitAndRetry: false,
            jobType: job.type,
            jobUserId: job.userId,
            jobAnalysisId: job.analysisId,
            jobMetadata: job.metadata,
            itemId: item._id,
            itemIndex: item.index,
            itemPayload: item.payload as JobItemPayload,
            itemAttempts: item.attempts + 1,
            isRetry: true,
            itemTimeoutMs: job.itemTimeoutMs,
          };
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Check concurrency limit
    // ═══════════════════════════════════════════════════════════════

    // Refresh claimed count after potential stale processing
    const activeClaimedItems = await ctx.db
      .query("jobItems")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "claimed")
      )
      .collect();

    if (activeClaimedItems.length >= job.concurrencyLimit) {
      return { waitAndRetry: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Claim next pending item
    // ═══════════════════════════════════════════════════════════════

    const pendingItem = await ctx.db
      .query("jobItems")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "pending")
      )
      .first();

    if (!pendingItem) {
      // No pending items - check if job should complete
      if (activeClaimedItems.length === 0) {
        await checkJobCompletion(ctx, job);
      }
      return null;
    }

    // Claim the item
    await ctx.db.patch(pendingItem._id, {
      status: "claimed",
      claimedAt: now,
      attempts: 1,
    });
    await ctx.db.patch(jobId, { lastActivityAt: now });

    return {
      waitAndRetry: false,
      jobType: job.type,
      jobUserId: job.userId,
      jobAnalysisId: job.analysisId,
      jobMetadata: job.metadata,
      itemId: pendingItem._id,
      itemIndex: pendingItem.index,
      itemPayload: pendingItem.payload as JobItemPayload,
      itemAttempts: 1,
      isRetry: false,
      itemTimeoutMs: job.itemTimeoutMs,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ITEM RELEASE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Release an item after processing.
 * Updates counters and checks for job completion.
 */
export const releaseItem = internalMutation({
  args: {
    jobId: v.id("jobs"),
    itemId: v.id("jobItems"),
    success: v.boolean(),
    skipped: v.optional(v.boolean()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  returns: releaseResultValidator,
  handler: async (ctx, args): Promise<ReleaseResult> => {
    const { jobId, itemId, success, skipped, result, error } = args;

    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");

    const item = await ctx.db.get(itemId);
    if (!item) throw new Error("Item not found");

    const now = Date.now();

    // Determine final item status
    let itemStatus: "succeeded" | "failed" | "skipped";
    if (success) {
      itemStatus = "succeeded";
    } else if (skipped) {
      itemStatus = "skipped";
    } else {
      itemStatus = "failed";
    }

    // Update item
    await ctx.db.patch(itemId, {
      status: itemStatus,
      completedAt: now,
      result: result,
      error: error,
    });

    // Update job counters
    const newProcessed = job.processed + 1;
    const newSucceeded = success ? job.succeeded + 1 : job.succeeded;
    const newFailed = !success && !skipped ? job.failed + 1 : job.failed;
    const newSkipped = skipped ? job.skipped + 1 : job.skipped;
    const newErrors = error
      ? [...job.errors.slice(-99), `[${item.index}] ${error}`]
      : job.errors;

    // Check if job is complete
    const isJobComplete = newProcessed >= job.totalItems;

    await ctx.db.patch(jobId, {
      processed: newProcessed,
      succeeded: newSucceeded,
      failed: newFailed,
      skipped: newSkipped,
      lastActivityAt: now,
      errors: newErrors,
      ...(isJobComplete
        ? { status: "completed", completedAt: now }
        : {}),
    });

    // If job completed, start dependent jobs
    let triggeredNextJob: typeof jobId | undefined;
    if (isJobComplete) {
      triggeredNextJob = await startDependentJobs(ctx, jobId);
    }

    return {
      processed: newProcessed,
      total: job.totalItems,
      isJobComplete,
      triggeredNextJob,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// JOB MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cancel a job and all its pending items.
 */
export const cancelJob = internalMutation({
  args: {
    jobId: v.id("jobs"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, reason }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    if (job.status === "completed" || job.status === "cancelled") {
      return null;
    }

    const now = Date.now();

    // Mark all pending and claimed items as skipped
    const pendingItems = await ctx.db
      .query("jobItems")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "pending")
      )
      .collect();

    const claimedItems = await ctx.db
      .query("jobItems")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "claimed")
      )
      .collect();

    for (const item of [...pendingItems, ...claimedItems]) {
      await ctx.db.patch(item._id, {
        status: "skipped",
        completedAt: now,
        error: reason ?? "Job cancelled",
      });
    }

    // Update job
    await ctx.db.patch(jobId, {
      status: "cancelled",
      completedAt: now,
      processed: job.totalItems,
      skipped: job.skipped + pendingItems.length + claimedItems.length,
      errors: [
        ...job.errors,
        reason ?? "Job cancelled by user",
      ],
    });

    // If this is an extraction job, update the analysis status to failed
    if (job.type === "extraction" && job.analysisId) {
      await ctx.scheduler.runAfter(0, internal.extraction.analysesMutations.setStatus, {
        id: job.analysisId,
        status: "failed",
      });
    }

    return null;
  },
});

/**
 * Retry all failed items in a job.
 * Re-queues them as pending and spawns workers.
 */
export const retryJob = internalMutation({
  args: {
    jobId: v.id("jobs"),
  },
  returns: v.object({
    retriedCount: v.number(),
    jobId: v.id("jobs"),
  }),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");

    const now = Date.now();

    // Get all failed items
    const failedItems = await ctx.db
      .query("jobItems")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "failed")
      )
      .collect();

    if (failedItems.length === 0) {
      return { retriedCount: 0, jobId };
    }

    // Reset failed items to pending
    for (const item of failedItems) {
      await ctx.db.patch(item._id, {
        status: "pending",
        attempts: 0,
        claimedAt: undefined,
        completedAt: undefined,
        result: undefined,
        error: undefined,
      });
    }

    // Update job counters and status
    await ctx.db.patch(jobId, {
      status: "running",
      processed: job.processed - failedItems.length,
      failed: 0,
      lastActivityAt: now,
      completedAt: undefined,
      errors: [
        ...job.errors.slice(-99),
        `Retrying ${failedItems.length} failed items`,
      ],
    });

    // Spawn workers
    const workers = Math.min(job.concurrencyLimit, failedItems.length);
    for (let i = 0; i < workers; i++) {
      await ctx.scheduler.runAfter(
        i * 50,
        internal.jobs.actions.processNextItem,
        { jobId }
      );
    }

    return { retriedCount: failedItems.length, jobId };
  },
});

/**
 * Fail a job with an error message.
 */
export const failJob = internalMutation({
  args: {
    jobId: v.id("jobs"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    if (job.status === "completed" || job.status === "failed") {
      return null;
    }

    await ctx.db.patch(jobId, {
      status: "failed",
      completedAt: Date.now(),
      errors: [...job.errors, error],
    });

    // If this is an extraction job, update the analysis status to failed
    if (job.type === "extraction" && job.analysisId) {
      await ctx.scheduler.runAfter(0, internal.extraction.analysesMutations.setStatus, {
        id: job.analysisId,
        status: "failed",
      });
    }

    return null;
  },
});

/**
 * Trigger dependent jobs for a completed job.
 * Used when a job auto-completes (0 items) to start the chain.
 */
export const triggerDependentJobs = internalMutation({
  args: {
    jobId: v.id("jobs"),
  },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    await startDependentJobs(ctx, jobId);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a job should be marked as completed.
 */


async function checkJobCompletion(
  ctx: MutationCtx,
  job: Job
): Promise<void> {
  // Count items by status
  const pendingCount = await ctx.db
    .query("jobItems")
    .withIndex("by_job_status", (q) =>
      q.eq("jobId", job._id).eq("status", "pending")
    )
    .collect();

  const claimedCount = await ctx.db
    .query("jobItems")
    .withIndex("by_job_status", (q) =>
      q.eq("jobId", job._id).eq("status", "claimed")
    )
    .collect();

  if (pendingCount.length === 0 && claimedCount.length === 0) {
    // All items processed
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "completed",
      completedAt: now,
    });

    // If this is an extraction job, update the analysis status to completed
    if (job.type === "extraction" && job.analysisId) {
      // Using scheduler is safer to avoid unrelated failures blocking job completion
      await ctx.scheduler.runAfter(0, internal.extraction.analysesMutations.setStatus, {
        id: job.analysisId,
        status: "completed",
      });
    }

    // Start dependent jobs
    await startDependentJobs(ctx, job._id);
  }
}

/**
 * Start jobs that depend on the completed job.
 * Re-queries for items based on current database state and adds any new items.
 * Returns the ID of the first job started, if any.
 */
async function startDependentJobs(
  ctx: MutationCtx,
  completedJobId: Id<"jobs">
): Promise<Id<"jobs"> | undefined> {
  const dependentJobs = await ctx.db
    .query("jobs")
    .withIndex("by_depends_on", (q) => q.eq("dependsOn", completedJobId))
    .collect();

  let firstStartedJob: Id<"jobs"> | undefined;

  for (const depJob of dependentJobs) {
    if (depJob.status === "pending") {
      const now = Date.now();

      // ═══════════════════════════════════════════════════════════════
      // STEP 1: Re-query for items based on CURRENT database state
      // This is critical because previous jobs may have created new eligible items
      // ═══════════════════════════════════════════════════════════════
      
      const newItems = await queryItemsForJobType(ctx, depJob.type, depJob.analysisId);
      
      // Get existing item keys to avoid duplicates
      // For extraction jobs, use composite key (documentId_questionId)
      // For other jobs, just use documentId
      const existingItems = await ctx.db
        .query("jobItems")
        .withIndex("by_job_status", (q) => q.eq("jobId", depJob._id))
        .collect();
      
      const existingKeys = new Set(
        existingItems.map((item) => {
          const payload = item.payload as JobItemPayload;
          if (payload.type === "extraction") {
            return `${payload.documentId}_${payload.questionId}`;
          }
          return String(payload.documentId);
        })
      );
      
      // Filter to only truly new items using appropriate key
      const itemsToAdd = newItems.filter((item) => {
        if (item.type === "extraction") {
          return !existingKeys.has(`${item.documentId}_${item.questionId}`);
        }
        return !existingKeys.has(String(item.documentId));
      });
      
      // ═══════════════════════════════════════════════════════════════
      // STEP 2: Insert new items into the job
      // ═══════════════════════════════════════════════════════════════
      
      let nextIndex = existingItems.length;
      for (const item of itemsToAdd) {
        await ctx.db.insert("jobItems", {
          jobId: depJob._id,
          index: nextIndex++,
          status: "pending",
          payload: item,
          attempts: 0,
        });
      }
      
      const totalItems = existingItems.length + itemsToAdd.length;
      
      if (itemsToAdd.length > 0) {
        console.log(
          `[Jobs] Added ${itemsToAdd.length} new items to ${depJob.type} job (total: ${totalItems})`
        );
      }
      
      // ═══════════════════════════════════════════════════════════════
      // STEP 3: Handle jobs with 0 items - auto-complete and chain
      // ═══════════════════════════════════════════════════════════════
      
      if (totalItems === 0) {
        console.log(
          `[Jobs] Job ${depJob._id} (${depJob.type}) has 0 items - auto-completing`
        );
        
        await ctx.db.patch(depJob._id, {
          status: "completed",
          totalItems: 0,
          processed: 0,
          completedAt: now,
          lastActivityAt: now,
        });
        
        // Recursively trigger next job in chain
        const nextJob = await startDependentJobs(ctx, depJob._id);
        if (!firstStartedJob) {
          firstStartedJob = nextJob;
        }
        continue;
      }
      
      // ═══════════════════════════════════════════════════════════════
      // STEP 4: Start the job and spawn workers
      // ═══════════════════════════════════════════════════════════════
      
      await ctx.db.patch(depJob._id, {
        status: "running",
        totalItems: totalItems,
        lastActivityAt: now,
      });

      // Count pending items (including newly added ones)
      const pendingItems = await ctx.db
        .query("jobItems")
        .withIndex("by_job_status", (q) =>
          q.eq("jobId", depJob._id).eq("status", "pending")
        )
        .collect();

      // Spawn workers
      const workers = Math.min(depJob.concurrencyLimit, pendingItems.length);
      for (let i = 0; i < workers; i++) {
        await ctx.scheduler.runAfter(
          i * 50,
          internal.jobs.actions.processNextItem,
          { jobId: depJob._id }
        );
      }

      console.log(
        `[Jobs] Started dependent job ${depJob._id} (${depJob.type}) with ${workers} workers for ${pendingItems.length} items`
      );

      if (!firstStartedJob) {
        firstStartedJob = depJob._id;
      }
    }
  }

  return firstStartedJob;
}

/**
 * Query items for a specific job type based on current database state.
 * Returns item payloads ready to be inserted as jobItems.
 */
async function queryItemsForJobType(
  ctx: MutationCtx,
  jobType: JobType,
  analysisId: Id<"analyses">
): Promise<JobItemPayload[]> {
  switch (jobType) {
    case "pdf_download": {
      // Get documents with open access URLs that haven't been processed
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
        .collect();
      
      return docs
        .filter((doc) => doc.openAccessUrl && !doc.fullText && !doc.pdfStorageId)
        .map((doc) => ({
          type: "pdf_download" as const,
          documentId: doc._id,
        }));
    }
    
    case "rag_indexing": {
      // Get unindexed documents with content (abstract or fullText)
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
        .collect();
      
      return docs
        .filter((doc) => !doc.ragEntryId && (doc.abstract || doc.fullText))
        .map((doc) => ({
          type: "rag_indexing" as const,
          documentId: doc._id,
        }));
    }
    
    case "extraction": {
      // Get analysis to find questions
      const analysis = await ctx.db.get(analysisId);
      if (!analysis?.extractionQuestions?.length) {
        return [];
      }
      
      // Get all documents
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
        .collect();
      
      // Get existing extraction results
      const existingResults = await ctx.db
        .query("extractionResults")
        .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
        .collect();
      
      const existingPairs = new Set(
        existingResults.map((r) => `${r.documentId}_${r.questionId}`)
      );
      
      // Build pending items
      const items: JobItemPayload[] = [];
      for (const doc of docs) {
        // Match original behavior: process all documents, not just RAG-indexed ones
        // RAG context is optional - extraction can work with just abstract
        
        // SKIP if no content available (abstract or fullText)
        if (!doc.abstract && !doc.fullText) {
          continue;
        }

        for (const q of analysis.extractionQuestions) {
          const key = `${doc._id}_${q.id}`;
          if (!existingPairs.has(key)) {
            items.push({
              type: "extraction" as const,
              documentId: doc._id,
              questionId: q.id,
            });
          }
        }
      }
      
      return items;
    }
    
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = jobType;
      console.warn(`[Jobs] Unknown job type for item query: ${_exhaustive}`);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC MUTATIONS (for manual intervention)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cancel a stuck job (public, for dashboard/admin use).
 */
export const cancelStuckJob = mutation({
  args: {
    jobId: v.id("jobs"),
    reason: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { jobId, reason }) => {
    await ctx.runMutation(internal.jobs.mutations.cancelJob, {
      jobId,
      reason: reason ?? "Manually cancelled",
    });
    return true;
  },
});

/**
 * Retry failed items in a job (public, for dashboard/admin use).
 */
export const retryFailedItems = mutation({
  args: {
    jobId: v.id("jobs"),
  },
  returns: v.number(),
  handler: async (ctx, { jobId }) => {
    const result: { retriedCount: number; jobId: Id<"jobs"> } = await ctx.runMutation(
      internal.jobs.mutations.retryJob,
      { jobId }
    );
    return result.retriedCount;
  },
});
