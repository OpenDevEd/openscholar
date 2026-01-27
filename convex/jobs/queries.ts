/**
 * Universal Job System - Queries
 *
 * Queries for job status, items, and health monitoring.
 */
import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  jobTypeValidator,
  jobStatusResponseValidator,
  jobItemResponseValidator,
  itemStatusValidator,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// JOB STATUS QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get job status by ID.
 */
export const getJobStatus = query({
  args: {
    jobId: v.id("jobs"),
  },
  returns: v.union(v.null(), jobStatusResponseValidator),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    return {
      _id: job._id,
      type: job.type,
      status: job.status,
      analysisId: job.analysisId,
      userId: job.userId,
      totalItems: job.totalItems,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      skipped: job.skipped,
      concurrencyLimit: job.concurrencyLimit,
      startedAt: job.startedAt,
      lastActivityAt: job.lastActivityAt,
      completedAt: job.completedAt,
      chainId: job.chainId,
      chainPosition: job.chainPosition,
      dependsOn: job.dependsOn,
      errors: job.errors,
    };
  },
});

/**
 * Get the latest job of a specific type for an analysis.
 */
export const getLatestJobByType = query({
  args: {
    analysisId: v.id("analyses"),
    type: jobTypeValidator,
  },
  returns: v.union(v.null(), jobStatusResponseValidator),
  handler: async (ctx, { analysisId, type }) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .filter((q) => q.eq(q.field("type"), type))
      .order("desc")
      .take(1);

    const job = jobs[0];
    if (!job) return null;

    return {
      _id: job._id,
      type: job.type,
      status: job.status,
      analysisId: job.analysisId,
      userId: job.userId,
      totalItems: job.totalItems,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      skipped: job.skipped,
      concurrencyLimit: job.concurrencyLimit,
      startedAt: job.startedAt,
      lastActivityAt: job.lastActivityAt,
      completedAt: job.completedAt,
      chainId: job.chainId,
      chainPosition: job.chainPosition,
      dependsOn: job.dependsOn,
      errors: job.errors,
    };
  },
});

/**
 * Get all jobs for an analysis.
 */
export const getJobsForAnalysis = query({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.array(jobStatusResponseValidator),
  handler: async (ctx, { analysisId }) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .order("desc")
      .collect();

    return jobs.map((job) => ({
      _id: job._id,
      type: job.type,
      status: job.status,
      analysisId: job.analysisId,
      userId: job.userId,
      totalItems: job.totalItems,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      skipped: job.skipped,
      concurrencyLimit: job.concurrencyLimit,
      startedAt: job.startedAt,
      lastActivityAt: job.lastActivityAt,
      completedAt: job.completedAt,
      chainId: job.chainId,
      chainPosition: job.chainPosition,
      dependsOn: job.dependsOn,
      errors: job.errors,
    }));
  },
});

/**
 * Get all jobs in a chain.
 */
export const getJobChain = query({
  args: {
    chainId: v.string(),
  },
  returns: v.array(jobStatusResponseValidator),
  handler: async (ctx, { chainId }) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_chain", (q) => q.eq("chainId", chainId))
      .collect();

    // Sort by chain position
    jobs.sort((a, b) => (a.chainPosition ?? 0) - (b.chainPosition ?? 0));

    return jobs.map((job) => ({
      _id: job._id,
      type: job.type,
      status: job.status,
      analysisId: job.analysisId,
      userId: job.userId,
      totalItems: job.totalItems,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      skipped: job.skipped,
      concurrencyLimit: job.concurrencyLimit,
      startedAt: job.startedAt,
      lastActivityAt: job.lastActivityAt,
      completedAt: job.completedAt,
      chainId: job.chainId,
      chainPosition: job.chainPosition,
      dependsOn: job.dependsOn,
      errors: job.errors,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// JOB ITEM QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all items for a job.
 */
export const getJobItems = query({
  args: {
    jobId: v.id("jobs"),
    status: v.optional(itemStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(jobItemResponseValidator),
  handler: async (ctx, { jobId, status, limit }) => {
    let items;

    if (status) {
      const query = ctx.db
        .query("jobItems")
        .withIndex("by_job_status", (q) =>
          q.eq("jobId", jobId).eq("status", status)
        );
      items = limit ? await query.take(limit) : await query.collect();
    } else {
      const query = ctx.db
        .query("jobItems")
        .withIndex("by_job", (q) => q.eq("jobId", jobId));
      items = limit ? await query.take(limit) : await query.collect();
    }

    return items.map((item) => ({
      _id: item._id,
      jobId: item.jobId,
      index: item.index,
      status: item.status,
      payload: item.payload,
      attempts: item.attempts,
      claimedAt: item.claimedAt,
      completedAt: item.completedAt,
      result: item.result,
      error: item.error,
    }));
  },
});

/**
 * Get failed items for a job (for retry UI).
 */
export const getFailedItems = query({
  args: {
    jobId: v.id("jobs"),
  },
  returns: v.array(jobItemResponseValidator),
  handler: async (ctx, { jobId }) => {
    const items = await ctx.db
      .query("jobItems")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "failed")
      )
      .collect();

    return items.map((item) => ({
      _id: item._id,
      jobId: item.jobId,
      index: item.index,
      status: item.status,
      payload: item.payload,
      attempts: item.attempts,
      claimedAt: item.claimedAt,
      completedAt: item.completedAt,
      result: item.result,
      error: item.error,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL QUERIES (for actions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get job by ID (internal).
 */
export const getJob = internalQuery({
  args: {
    jobId: v.id("jobs"),
  },
  handler: async (ctx, { jobId }) => {
    return await ctx.db.get(jobId);
  },
});

/**
 * Get running jobs (for watchdog).
 */
export const getRunningJobs = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
  },
});

/**
 * Get pending jobs with dependencies (for watchdog).
 */
export const getPendingJobsWithDependencies = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pendingJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    // Filter to only those with dependencies
    return pendingJobs.filter((job) => job.dependsOn !== undefined);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH MONITORING QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get job system health metrics.
 */
export const getSystemHealth = query({
  args: {},
  returns: v.object({
    runningJobs: v.number(),
    pendingJobs: v.number(),
    completedLast24h: v.number(),
    failedLast24h: v.number(),
    staleItemCount: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Count running jobs
    const runningJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();

    // Count pending jobs
    const pendingJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    // Count completed in last 24h
    const completedJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .filter((q) => q.gte(q.field("completedAt"), oneDayAgo))
      .collect();

    // Count failed in last 24h
    const failedJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.gte(q.field("completedAt"), oneDayAgo))
      .collect();

    // Count stale claimed items across all running jobs
    let staleItemCount = 0;
    for (const job of runningJobs) {
      const claimedItems = await ctx.db
        .query("jobItems")
        .withIndex("by_job_status", (q) =>
          q.eq("jobId", job._id).eq("status", "claimed")
        )
        .collect();

      for (const item of claimedItems) {
        const claimedAt = item.claimedAt ?? 0;
        if (now - claimedAt > job.itemTimeoutMs) {
          staleItemCount++;
        }
      }
    }

    return {
      runningJobs: runningJobs.length,
      pendingJobs: pendingJobs.length,
      completedLast24h: completedJobs.length,
      failedLast24h: failedJobs.length,
      staleItemCount,
    };
  },
});
