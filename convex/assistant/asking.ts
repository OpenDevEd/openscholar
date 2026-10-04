/**
 * Asking first (decisions 8 and 12). A reply that calls an action the person has to allow
 * ends there: the call is kept as a step that waits, and the reply holds the chat. Their
 * answer reaches the model as the call's result: what the action returned once they
 * allowed it, or that they didn't. When every call the reply asked about is answered, the
 * reply carries on from there. Stopping it declines what still waits (./steps.ts).
 *
 * Apart from the tools, because `first` reads the database and the registry.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { internalQuery, mutation } from "../lib/functions";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { requireThread } from "./access";
import { declineSteps, stepsOfExchange } from "./steps";

/** Whether one call of an action asks the person first, where the action itself doesn't always. */
export const first = internalQuery({
  // `input` is the call's arguments, as JSON.
  args: { userId: v.id("users"), path: v.string(), input: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId, path, input }) => {
    const entry = USER_ACTIONS.find((candidate) => candidate.path === path);
    if (!entry || entry.kind === "query" || !entry.asksFirst) return false;
    return entry.asksFirst(ctx, userId, JSON.parse(input));
  },
});

/** The person's answer to a call the assistant asked about: run it, or don't. */
export const answer = mutation({
  args: { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps"), allow: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, stepId, allow }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, "assistant.enabled", userId);
    const { thread } = await requireThread(ctx, userId, threadId, "write");
    const step = await ctx.db.get("assistantSteps", stepId);
    const waiting = thread.reply?.asking;
    if (!step || step.threadId !== threadId) throw createError("NOT_FOUND", "That step isn't in this chat.");
    if (!thread.reply || !waiting || step.order !== thread.reply.order || step.status !== "asking") throw createError("CONFLICT", "This has already been answered.");
    // It would run with their access, on their records, so the answer is theirs alone.
    if (step.userId !== userId) throw createError("FORBIDDEN", "Only the person the assistant is answering can allow this.");
    if (allow) await ctx.db.patch("assistantSteps", stepId, { status: "allowed" });
    else await declineSteps(ctx, thread.agentThreadId, waiting.promptMessageId, [step]);
    // Calls it asked about together are answered one by one. The reply carries on after the last.
    const exchange = await stepsOfExchange(ctx, threadId, step.order);
    if (exchange.some((other) => other.status === "asking" && other._id !== stepId)) return null;
    const now = Date.now();
    const attemptId = `${now}:${Math.random().toString(36).slice(2)}`;
    const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.reply, {
      threadId,
      agentThreadId: thread.agentThreadId,
      promptMessageId: waiting.promptMessageId,
      attemptId,
      senderId: thread.reply.senderId,
      modelId: waiting.modelId,
      effort: waiting.effort,
    });
    await ctx.db.patch("assistantThreads", threadId, { reply: { attemptId, senderId: thread.reply.senderId, order: thread.reply.order, startedAt: now, scheduledId } });
    return null;
  },
});
