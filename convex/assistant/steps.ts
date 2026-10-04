/**
 * The steps a reply takes (#327): one row for each action the assistant runs. The model reads
 * a short form of an action's result; the row keeps the whole of it, and the command that
 * reverses it when there is one (#342), for the chat's page and for Undo.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/** Characters of an action's arguments a step keeps. An action's arguments are small; this bounds a careless one. */
export const STEP_INPUT_MAX = 16_000;
/** Characters of an action's result a step keeps, well inside one document. */
export const STEP_RESULT_MAX = 200_000;
/** Steps one batch deletes of a chat being deleted. */
const FORGET_BATCH = 100;

const stepOf = (ctx: Pick<QueryCtx, "db">, threadId: Id<"assistantThreads">, toolCallId: string) =>
  ctx.db.query("assistantSteps").withIndex("by_thread_and_toolCallId", (q) => q.eq("threadId", threadId).eq("toolCallId", toolCallId)).unique();

/** The steps of these calls, by call ID: one indexed read a call. */
export async function stepsOf(ctx: Pick<QueryCtx, "db">, threadId: Id<"assistantThreads">, toolCallIds: string[]) {
  const rows = await Promise.all(toolCallIds.map((toolCallId) => stepOf(ctx, threadId, toolCallId)));
  return new Map(rows.flatMap((row) => (row ? [[row.toolCallId, row] as const] : [])));
}

/** A step starts. A call that is tried again keeps its first row. */
export const begin = internalMutation({
  args: { threadId: v.id("assistantThreads"), order: v.number(), toolCallId: v.string(), path: v.string(), input: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await stepOf(ctx, args.threadId, args.toolCallId))) await ctx.db.insert("assistantSteps", { ...args, status: "running", startedAt: Date.now() });
    return null;
  },
});

/** A step ends, with its result or with why it failed. */
export const end = internalMutation({
  args: {
    threadId: v.id("assistantThreads"),
    toolCallId: v.string(),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    undo: v.optional(v.object({ path: v.string(), args: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, toolCallId, result, error, undo }) => {
    const step = await stepOf(ctx, threadId, toolCallId);
    if (step) {
      await ctx.db.patch("assistantSteps", step._id, {
        status: error === undefined ? "done" : "failed",
        ...(result === undefined ? {} : { result }),
        ...(error === undefined ? {} : { error }),
        ...(undo ? { undo } : {}),
        endedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Deletes a deleted chat's steps, a batch at a time, until none are left. */
export const forget = internalMutation({
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const steps = await ctx.db.query("assistantSteps").withIndex("by_thread_and_toolCallId", (q) => q.eq("threadId", threadId)).take(FORGET_BATCH);
    for (const step of steps) await ctx.db.delete("assistantSteps", step._id);
    if (steps.length === FORGET_BATCH) await ctx.scheduler.runAfter(0, internal.assistant.steps.forget, { threadId });
    return null;
  },
});

export type Step = Doc<"assistantSteps">;
