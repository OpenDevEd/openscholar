/**
 * Chat messages surface. Mutations and a query for the chat thread
 * lifecycle after the thread has been provisioned (ensureThreadForJob).
 *
 * Flow:
 *   sendMessage (mutation)          ← client calls this
 *     ↓ acquires per-thread lock
 *     ↓ saves the user message via paperChat.saveMessage
 *     ↓ bumps messageCount + lastMessageAt
 *     ↓ schedules generateResponse
 *   generateResponse (internal action)
 *     ↓ pre-flight credit check (throws AI_INSUFFICIENT_CREDITS)
 *     ↓ resolves per-job model via resolveOpenRouterModel
 *     ↓ paperChat.streamText with saveStreamDeltas
 *     ↓ try/finally releases the lock
 *   listThreadMessages (query)
 *     ← reactive subscription on client; drives useUIMessages
 *   regenerateLastAssistant / clearThread / swapModel: affordances.
 */

import {
  internalAction,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { paperChat } from "./agent";
import { authorizeThreadAccess } from "./threads";
import { resolveOpenRouterModel } from "./provider";
import { ESTIMATED_CREDITS_PER_CHAT_MESSAGE } from "../lib/constants";

/* ────────────────────────────────────────────────────────────────── */
/*                      User → Assistant turn                         */
/* ────────────────────────────────────────────────────────────────── */

export const sendMessage = mutation({
  args: { threadId: v.string(), prompt: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, prompt }) => {
    if (prompt.trim().length === 0) {
      throw createError("VALIDATION_ERROR", "Prompt must not be empty");
    }
    const { job } = await authorizeThreadAccess(ctx, threadId);

    // Inline lock logic — runMutation to acquireThreadLock would be a
    // separate transaction; we want the lock set atomically with the
    // user-message insert below so a concurrent sendMessage can't slip
    // in between acquire + save.
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "A response is already being generated for this chat.",
      );
    }

    const { messageId } = await paperChat.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });

    const now = Date.now();
    await ctx.db.patch(job._id, {
      isGenerating: true,
      generatingStartedAt: now,
      lastMessageAt: now,
      messageCount: (job.messageCount ?? 0) + 1,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId: messageId },
    );

    return null;
  },
});

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, promptMessageId }) => {
    const meta = await ctx.runQuery(
      internal.chat.threads.getModelForThread,
      { threadId },
    );
    if (!meta) {
      throw createError("NOT_FOUND", "Thread not found");
    }
    const { jobId, userId, chatModelId } = meta;

    try {
      const balance = await ctx.runQuery(
        internal.credits.internal.getBalanceByUserId,
        { userId },
      );
      if (!balance || balance.total < ESTIMATED_CREDITS_PER_CHAT_MESSAGE) {
        throw createError(
          "AI_INSUFFICIENT_CREDITS",
          "Not enough credits for this chat message.",
        );
      }

      const { model } = await resolveOpenRouterModel(ctx, chatModelId);

      const result = await paperChat.streamText(
        ctx,
        { threadId, userId },
        {
          promptMessageId,
          model,
        },
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      await result.consumeStream();
    } finally {
      await ctx.runMutation(
        internal.chat.concurrency.releaseThreadLock,
        { jobId },
      );
    }
    return null;
  },
});

/* ────────────────────────────────────────────────────────────────── */
/*                        Reactive message list                       */
/* ────────────────────────────────────────────────────────────────── */

export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    streams: v.optional(v.any()),
  }),
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId);
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});

/* ────────────────────────────────────────────────────────────────── */
/*                  Regenerate / Clear / Swap model                   */
/* ────────────────────────────────────────────────────────────────── */

export const regenerateLastAssistant = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "Wait for the current response before regenerating.",
      );
    }

    const page = await paperChat.listMessages(ctx, {
      threadId,
      paginationOpts: { numItems: 4, cursor: null },
    });
    // paperChat.listMessages returns newest-first (order: "desc" inside
    // the agent component), so msgs[0] is the latest message and msgs[1]
    // is the one before it. We need the last assistant and its prior user.
    const msgs = page.page;
    if (msgs.length < 2) return null;
    const last = msgs[0];
    const prev = msgs[1];
    if (last.message?.role !== "assistant") return null;
    if (prev.message?.role !== "user") return null;

    await paperChat.deleteMessage(ctx, { messageId: last._id });

    const now = Date.now();
    await ctx.db.patch(job._id, {
      isGenerating: true,
      generatingStartedAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId: prev._id },
    );
    return null;
  },
});

export const clearThread = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "Wait for the current response before clearing.",
      );
    }

    let startOrder: number | undefined = 0;
    // Loop because deleteMessageRange paginates internally — keep
    // invoking until it signals isDone.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await paperChat.deleteMessageRange(ctx, {
        threadId,
        startOrder: startOrder ?? 0,
        endOrder: Number.MAX_SAFE_INTEGER,
      });
      if (r.isDone) break;
      startOrder = r.lastOrder;
    }

    await ctx.db.patch(job._id, {
      messageCount: 0,
      lastMessageAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const swapModel = mutation({
  args: {
    threadId: v.string(),
    modelId: v.id("models"),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, modelId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    await ctx.db.patch(job._id, {
      chatModelId: modelId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/* ────────────────────────────────────────────────────────────────── */
/*                          Mid-stream abort                          */
/* ────────────────────────────────────────────────────────────────── */

export const abortGeneration = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (!job.isGenerating) return null;
    await ctx.db.patch(job._id, {
      shouldAbort: true,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const shouldAbortInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.boolean(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    return job?.shouldAbort === true;
  },
});

// Export unused helper so TypeScript keeps the Id import alive — helps
// any future caller that wants to type a modelId locally.
export type ChatMessageJobId = Id<"extractionJobs">;
