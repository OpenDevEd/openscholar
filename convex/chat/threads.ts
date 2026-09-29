/**
 * Chat thread lifecycle — creation, authorization, metadata lookup.
 * Thread content (messages, streams) is owned by the Agent component
 * and accessed via paperChat.*; this file owns only the join between
 * our extractionJobs row (mode: "chat") and the agent's thread.
 */

import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
  type MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { assertCallerOwnsJob, authorizeThreadAccess } from "./auth";
import { paperChat } from "./agent";
import { dedupeExpandedSources, expandJobSources } from "../extraction/expandSources";
import { assertBucketWithinLimits } from "../extraction/bucket/limits";
import { replaceJobSources, type BucketItemInput } from "../extraction/jobSources";
import type { PaperData } from "../extraction/types";
import { internal } from "../_generated/api";
import {
  bucketItemInputValidator,
  storedBucketItemValidator,
  structuredErrorValidator,
} from "../extraction/validators";
import { classifyUnknownError } from "@/lib/errors/taxonomy";
import {
  assertNonEmptyOpenAlexSourceIds,
  hasSameOrderedOpenAlexIds,
  orderedOpenAlexIds,
} from "./sourceRefreshModel";

function classifyChatPrepError(error: unknown) {
  const result = classifyUnknownError(error);
  if (result.message === "Unknown error") {
    return { ...result, message: "Chat preparation failed." };
  }
  return result;
}

async function resolvePreparedSources(
  ctx: ActionCtx,
  jobId: Id<"extractionJobs">,
): Promise<BucketItemInput[]> {
  const bucketItems = await ctx.runQuery(
    internal.extraction.queries.internal.getJobSourcesInternal,
    { jobId },
  );
  return await resolvePreparedSourcesFromItems(ctx, bucketItems);
}

async function resolvePreparedSourcesFromItems(
  ctx: ActionCtx,
  bucketItems: BucketItemInput[],
): Promise<BucketItemInput[]> {
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

const chatSourceRefreshResultValidator = v.object({
  jobId: v.id("extractionJobs"),
  changed: v.boolean(),
  sourcesChanged: v.boolean(),
});

type ChatJobForSourceRefresh = {
  _id: Id<"extractionJobs">;
  userId: Id<"users">;
  chatThreadId: string | null;
  isGenerating: boolean;
  chatSourceFingerprint: string | null;
};

type ChatSourceRefreshResult = {
  jobId: Id<"extractionJobs">;
  changed: boolean;
  sourcesChanged: boolean;
};

function toValidationError(error: unknown) {
  return error instanceof Error ? error.message : "Invalid chat sources.";
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
      assertBucketWithinLimits(
        preparedSources.map((item) => ({
          source: item.source,
          searchFilters: item.searchFilters,
        })),
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
      const classified = classifyChatPrepError(error);
      await ctx.runMutation(internal.chat.threads.failThreadForJob, {
        jobId,
        error: {
          code: classified.code,
          message: classified.message,
          ...(classified.context !== undefined ? { context: classified.context } : {}),
          ...(classified.httpStatus !== undefined
            ? { httpStatus: classified.httpStatus }
            : {}),
          ...(classified.providerName !== undefined
            ? { providerName: classified.providerName }
            : {}),
          at: Date.now(),
        },
      });
      throw error;
    }
  },
});

/**
 * Lighter-weight thread bootstrap for duplicated chat jobs. The sources
 * and chatPapers have already been cloned inside `duplicateJob`'s
 * transaction, so we skip source resolution / replace / seed entirely
 * and just create the agent thread + patch chatThreadId. Re-resolving
 * saved-search sources would break the "duplicate preserves state"
 * contract — the cloned job must mirror the original's paper set at
 * duplication time, not re-fetch live data.
 */
export const createThreadForDuplicatedJob = internalAction({
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
        "createThreadForDuplicatedJob called on a non-chat job",
      );
    }
    if (job.chatThreadId) {
      return { threadId: job.chatThreadId };
    }

    try {
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
      const classified = classifyChatPrepError(error);
      await ctx.runMutation(internal.chat.threads.failThreadForJob, {
        jobId,
        error: {
          code: classified.code,
          message: classified.message,
          ...(classified.context !== undefined ? { context: classified.context } : {}),
          ...(classified.httpStatus !== undefined
            ? { httpStatus: classified.httpStatus }
            : {}),
          ...(classified.providerName !== undefined
            ? { providerName: classified.providerName }
            : {}),
          at: Date.now(),
        },
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

export const getChatJobForSourceRefresh = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    _id: v.id("extractionJobs"),
    userId: v.id("users"),
    chatThreadId: v.union(v.string(), v.null()),
    isGenerating: v.boolean(),
    chatSourceFingerprint: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { jobId }) => {
    const { job } = await assertCallerOwnsJob(ctx, jobId);
    return {
      _id: job._id,
      userId: job.userId,
      chatThreadId: job.chatThreadId ?? null,
      isGenerating: job.isGenerating ?? false,
      chatSourceFingerprint: job.chatSourceFingerprint ?? null,
    };
  },
});

export const continueChatWithSourceRefresh = action({
  args: {
    jobId: v.id("extractionJobs"),
    bucketItems: v.array(bucketItemInputValidator),
    sourceFingerprint: v.string(),
  },
  returns: chatSourceRefreshResultValidator,
  handler: async (
    ctx,
    { jobId, bucketItems, sourceFingerprint },
  ): Promise<ChatSourceRefreshResult> => {
    const job: ChatJobForSourceRefresh = await ctx.runQuery(
      internal.chat.threads.getChatJobForSourceRefresh,
      { jobId },
    );

    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "A response is already being generated for this chat.",
      );
    }
    if (!job.chatThreadId) {
      throw createError(
        "CONFLICT",
        "This chat is still being prepared. Try again in a moment.",
      );
    }

    if (job.chatSourceFingerprint === sourceFingerprint) {
      return { jobId, changed: false, sourcesChanged: false };
    }

    const preparedSources = await resolvePreparedSourcesFromItems(
      ctx,
      bucketItems,
    );
    const nextOpenAlexIds = orderedOpenAlexIds(preparedSources);
    try {
      assertNonEmptyOpenAlexSourceIds(nextOpenAlexIds);
    } catch (error) {
      throw createError("VALIDATION_ERROR", toValidationError(error));
    }

    assertBucketWithinLimits(
      preparedSources.map((item) => ({
        source: item.source,
        searchFilters: item.searchFilters,
      })),
    );

    return await ctx.runMutation(
      internal.chat.threads.applyChatSourceRefresh,
      {
        jobId,
        items: preparedSources,
        sourceFingerprint,
      },
    );
  },
});

async function replaceChatSourcesForJob(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">,
  items: BucketItemInput[],
  opts: { preserveInclusion: boolean },
) {
  const existingPapers = await ctx.db
    .query("chatPapers")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect();
  const existingSources = opts.preserveInclusion
    ? await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
        .collect()
    : [];

  const sourceById = new Map(
    existingSources.map((source) => [source._id, source]),
  );
  const includedByOpenAlexId = new Map<string, boolean>();
  if (opts.preserveInclusion) {
    for (const paper of existingPapers) {
      const openalexId = sourceById.get(paper.sourceId)?.openalexId?.trim();
      if (openalexId && !includedByOpenAlexId.has(openalexId)) {
        includedByOpenAlexId.set(openalexId, paper.included);
      }
    }
  }

  for (const row of existingPapers) {
    await ctx.db.delete(row._id);
  }

  await replaceJobSources(ctx, jobId, items);

  const newSources = await ctx.db
    .query("extractionJobSources")
    .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
    .collect();
  for (const source of newSources) {
    const openalexId = source.openalexId?.trim();
    await ctx.db.insert("chatPapers", {
      jobId,
      sourceId: source._id,
      included:
        openalexId && includedByOpenAlexId.has(openalexId)
          ? includedByOpenAlexId.get(openalexId)!
          : true,
    });
  }
}

export const applyChatSourceRefresh = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    items: v.array(storedBucketItemValidator),
    sourceFingerprint: v.string(),
  },
  returns: chatSourceRefreshResultValidator,
  handler: async (ctx, { jobId, items, sourceFingerprint }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.mode !== "chat") {
      throw createError("NOT_FOUND", "Chat job not found");
    }
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "A response is already being generated for this chat.",
      );
    }
    if (!job.chatThreadId) {
      throw createError(
        "CONFLICT",
        "This chat is still being prepared. Try again in a moment.",
      );
    }

    const currentSources = await ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
      .collect();
    const currentOpenAlexIds = orderedOpenAlexIds(currentSources);
    const nextOpenAlexIds = orderedOpenAlexIds(items);
    try {
      assertNonEmptyOpenAlexSourceIds(nextOpenAlexIds);
    } catch (error) {
      throw createError("VALIDATION_ERROR", toValidationError(error));
    }

    const sourcesChanged = !hasSameOrderedOpenAlexIds(
      currentOpenAlexIds,
      nextOpenAlexIds,
    );
    const fingerprintChanged = job.chatSourceFingerprint !== sourceFingerprint;
    if (!fingerprintChanged && !sourcesChanged) {
      return { jobId, changed: false, sourcesChanged: false };
    }

    await replaceChatSourcesForJob(ctx, jobId, items, {
      preserveInclusion: true,
    });

    const now = Date.now();
    if (sourcesChanged) {
      await ctx.db.insert("chatSourceEvents", {
        jobId,
        threadId: job.chatThreadId,
        kind: "sources_updated",
        boundaryOrder: job.messageCount ?? 0,
        createdAt: now,
      });
    }

    await ctx.db.patch(jobId, {
      chatSourceFingerprint: sourceFingerprint,
      chatSourceOpenAlexIds: nextOpenAlexIds,
      error: undefined,
      updatedAt: now,
    });

    return { jobId, changed: true, sourcesChanged };
  },
});

export const persistPreparedSourcesForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    items: v.array(storedBucketItemValidator),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, items }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.mode !== "chat") {
      throw createError("NOT_FOUND", "Chat job not found");
    }

    await replaceChatSourcesForJob(ctx, jobId, items, {
      preserveInclusion: false,
    });

    await ctx.db.patch(jobId, {
      chatSourceOpenAlexIds: orderedOpenAlexIds(items).filter(Boolean),
      error: undefined,
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
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const failThreadForJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    error: structuredErrorValidator,
  },
  returns: v.null(),
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.mode !== "chat" || job.chatThreadId) {
      return null;
    }
    await ctx.db.patch(jobId, {
      error,
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
 *
 * Also surfaces `webSearchEnabled` (from the job row) and
 * `modelSupportedParameters` (joined from the chosen model row, when
 * `chatModelId` is set) in a single round-trip. Both feed the plan-06
 * tool selector and system-prompt builder. `modelSupportedParameters`
 * is `null` when no model is chosen yet — `modelSupportsWebSearch`
 * treats that as "no capability", which is the conservative default
 * for the ungated fallback path.
 */
export const getModelForThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("extractionJobs"),
      userId: v.id("users"),
      chatModelId: v.union(v.id("models"), v.null()),
      webSearchEnabled: v.boolean(),
      modelSupportedParameters: v.union(v.array(v.string()), v.null()),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const job = await ctx.db
      .query("extractionJobs")
      .withIndex("by_chatThread", (q) => q.eq("chatThreadId", threadId))
      .unique();
    if (!job || job.mode !== "chat") return null;

    let modelSupportedParameters: string[] | null = null;
    if (job.chatModelId) {
      const modelRow = await ctx.db.get(job.chatModelId);
      modelSupportedParameters = modelRow?.retiredAt === undefined ? modelRow?.supportedParameters ?? null : null;
    }

    return {
      jobId: job._id,
      userId: job.userId,
      chatModelId: job.chatModelId ?? null,
      webSearchEnabled: job.webSearchEnabled ?? false,
      modelSupportedParameters,
    };
  },
});

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
