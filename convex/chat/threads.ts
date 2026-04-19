/**
 * Chat thread lifecycle — creation, authorization, metadata lookup.
 * Thread content (messages, streams) is owned by the Agent component
 * and accessed via paperChat.*; this file owns only the join between
 * our extractionJobs row (mode: "chat") and the agent's thread.
 */

import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { v } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { paperChat } from "./agent";
import { dedupeExpandedSources, expandJobSources } from "../extraction/expandSources";
import { replaceJobSources, type BucketItemInput } from "../extraction/jobSources";
import type { PaperData } from "../extraction/types";
import { internal } from "../_generated/api";
import { bucketItemInputValidator } from "../extraction/validators";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Chat preparation failed.";
}

async function resolvePreparedSources(
  ctx: ActionCtx,
  jobId: Id<"extractionJobs">,
): Promise<BucketItemInput[]> {
  const bucketItems = await ctx.runQuery(
    internal.extraction.queries.internal.getJobSourcesInternal,
    { jobId },
  );
  let cachedZoteroUserId: string | undefined;

  const expanded = await expandJobSources(bucketItems, {
    fetchPapersFromHistory: async (searchFilters) => {
      const result = await ctx.runAction(
        internal.extraction.actions.fetchPapersFromHistory,
        { searchFilters },
      );
      return result as PaperData[];
    },
    resolveZoteroUserId: async () => {
      if (cachedZoteroUserId !== undefined) {
        return cachedZoteroUserId;
      }
      try {
        const resolved = await ctx.runQuery(
          internal.zotero.queries.getZoteroUserIdInternal,
          {},
        );
        cachedZoteroUserId = resolved ?? undefined;
      } catch {
        cachedZoteroUserId = undefined;
      }
      return cachedZoteroUserId;
    },
  });

  return dedupeExpandedSources(expanded).map((item) => item.bucketItem);
}

/**
 * Atomic: creates an agent thread for `jobId` and patches the job row
 * with the resulting chatThreadId. Scheduled from startJob's chat
 * branch, so it commits in its own transaction — UI polls for the job
 * row to pick up the threadId via the reactive getJob subscription.
 *
 * Idempotent: if the job already has a chatThreadId, returns it.
 * If the job doesn't exist or is extraction-mode, throws.
 */
export const ensureThreadForJob = internalAction({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, { jobId }): Promise<{ threadId: string }> => {
    const job = await ctx.runQuery(
      internal.chat.threads.getChatJobForPreparation,
      { jobId },
    );
    if (!job) {
      throw createError("NOT_FOUND", "Job not found");
    }
    if (job.mode !== "chat") {
      throw createError(
        "VALIDATION_ERROR",
        "ensureThreadForJob called on a non-chat job",
      );
    }
    if (job.chatThreadId) {
      return { threadId: job.chatThreadId };
    }

    try {
      const preparedSources = await resolvePreparedSources(ctx, jobId);
      await ctx.runQuery(
        internal.extraction.bucket.limits.assertBucketWithinLimitsForUser,
        {
          userId: job.userId,
          items: preparedSources.map((item) => ({
            source: item.source,
            searchFilters: item.searchFilters,
          })),
        },
      );
      await ctx.runMutation(internal.chat.threads.persistPreparedSourcesForJob, {
        jobId,
        items: preparedSources,
      });

      const { threadId } = await paperChat.createThread(ctx, {
        userId: job.userId,
        title: job.name,
      });

      await ctx.runMutation(internal.chat.threads.completeThreadForJob, {
        jobId,
        threadId,
      });

      return { threadId };
    } catch (error) {
      await ctx.runMutation(internal.chat.threads.failThreadForJob, {
        jobId,
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }
  },
});

export const getChatJobForPreparation = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("extractionJobs"),
      userId: v.id("users"),
      mode: v.union(v.literal("chat"), v.literal("extraction")),
      name: v.string(),
      chatThreadId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      return null;
    }
    return {
      _id: job._id,
      userId: job.userId,
      mode: job.mode,
      name: job.name,
      chatThreadId: job.chatThreadId,
    };
  },
});

export const persistPreparedSourcesForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    items: v.array(bucketItemInputValidator),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, items }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.mode !== "chat") {
      throw createError("NOT_FOUND", "Chat job not found");
    }
    await replaceJobSources(ctx, jobId, items);
    await ctx.db.patch(jobId, {
      errorMessage: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const completeThreadForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, threadId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.mode !== "chat") {
      throw createError("NOT_FOUND", "Chat job not found");
    }
    if (job.chatThreadId) {
      return null;
    }
    await ctx.db.patch(jobId, {
      chatThreadId: threadId,
      errorMessage: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const failThreadForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, errorMessage }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.mode !== "chat" || job.chatThreadId) {
      return null;
    }
    await ctx.db.patch(jobId, {
      errorMessage,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Reads the chat-mode job's metadata pre-send. Consumers need the
 * userId for Agent usageHandler attribution and chatModelId for the
 * per-turn model override.
 */
export const getThreadMetadataForJob = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("extractionJobs"),
      userId: v.id("users"),
      threadId: v.union(v.string(), v.null()),
      chatModelId: v.union(v.id("models"), v.null()),
      isGenerating: v.boolean(),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.mode !== "chat") return null;
    return {
      jobId: job._id,
      userId: job.userId,
      threadId: job.chatThreadId ?? null,
      chatModelId: job.chatModelId ?? null,
      isGenerating: job.isGenerating ?? false,
    };
  },
});

/**
 * Reverse-lookup flavour of getThreadMetadataForJob — used by
 * generateResponse after the thread is already established.
 */
export const getModelForThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("extractionJobs"),
      userId: v.id("users"),
      chatModelId: v.union(v.id("models"), v.null()),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const job = await ctx.db
      .query("extractionJobs")
      .withIndex("by_chatThread", (q) => q.eq("chatThreadId", threadId))
      .unique();
    if (!job || job.mode !== "chat") return null;
    return {
      jobId: job._id,
      userId: job.userId,
      chatModelId: job.chatModelId ?? null,
    };
  },
});

/**
 * Shared ownership guard. Every public chat mutation/query starts with
 * this — the thread id is the only handle the client has, so we must
 * resolve it to a job and verify the caller owns it.
 */
export async function authorizeThreadAccess(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
): Promise<{ job: Doc<"extractionJobs">; user: Doc<"users"> }> {
  const user = await requireAuth(ctx);
  const job = await ctx.db
    .query("extractionJobs")
    .withIndex("by_chatThread", (q) => q.eq("chatThreadId", threadId))
    .unique();
  if (!job || job.userId !== user._id || job.mode !== "chat") {
    throw createError("FORBIDDEN", "Access denied");
  }
  return { job, user };
}

/**
 * Thin public wrapper around authorizeThreadAccess for client-side
 * UIs that just want to confirm a thread they hold is still theirs.
 */
export const authorizeThread = mutation({
  args: { threadId: v.string() },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, { threadId }): Promise<{ jobId: Id<"extractionJobs"> }> => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    return { jobId: job._id };
  },
});
