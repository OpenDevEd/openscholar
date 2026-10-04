/**
 * The steps a reply takes (#327): one row for each action the assistant runs, and the
 * command that reverses it when there is one (#342), for the chat's page and for Undo. The
 * model reads a short form of an action's result; the whole of it is kept beside the step.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/** Characters of an action's arguments, of what reverses it, and of why it failed, that a step keeps. */
export const STEP_TEXT_MAX = 16_000;
/** Characters of an action's result that are kept, well inside one document. */
export const STEP_RESULT_MAX = 200_000;
/** Steps of one exchange a page of the chat shows. A reply takes few; this bounds a runaway one. */
export const STEPS_SHOWN = 60;
/** Rows one batch deletes of a chat being deleted: results are large, so few at a time. */
const FORGET_RESULTS = 20;
const FORGET_STEPS = 100;

/** An exchange's steps, in the order they ran. */
export function stepsOfExchange(ctx: Pick<QueryCtx, "db">, threadId: Id<"assistantThreads">, order: number) {
  return ctx.db.query("assistantSteps").withIndex("by_thread_and_order", (q) => q.eq("threadId", threadId).eq("order", order)).take(STEPS_SHOWN);
}

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** The command that reverses a change, when its result carries one (#342) short enough to keep. */
export function undoOf(result: unknown) {
  const undo = result && typeof result === "object" && "undo" in result ? (result as { undo?: { path?: unknown; args?: unknown } }).undo : undefined;
  if (!undo || typeof undo.path !== "string") return undefined;
  const args = JSON.stringify(undo.args ?? {});
  return args.length <= STEP_TEXT_MAX ? { path: undo.path, args } : undefined;
}

/** How many things a result lists: its page's rows, or its own when it's a list. */
export function countOf(result: unknown) {
  if (Array.isArray(result)) return result.length;
  const page = result && typeof result === "object" ? (result as { page?: unknown }).page : undefined;
  return Array.isArray(page) ? page.length : undefined;
}

/**
 * Ends a step with what its action returned: the result is kept beside it, with what
 * reverses it and how many things it lists. A change calls this in its own transaction
 * (convex/lib/userActions.ts), so a change and the record of it are saved together or not at all.
 */
export async function endStep(ctx: Pick<MutationCtx, "db">, stepId: Id<"assistantSteps">, result: unknown) {
  const step = await ctx.db.get("assistantSteps", stepId);
  // Its chat was deleted while it ran.
  if (!step) return;
  const [undo, count] = [undoOf(result), countOf(result)];
  await ctx.db.patch("assistantSteps", stepId, { status: "done", ...(count === undefined ? {} : { count }), ...(undo ? { undo } : {}), endedAt: Date.now() });
  await ctx.db.insert("assistantStepResults", { threadId: step.threadId, stepId, result: cut(JSON.stringify(result ?? null), STEP_RESULT_MAX) });
}

/** A step starts. */
export const begin = internalMutation({
  args: { threadId: v.id("assistantThreads"), order: v.number(), userId: v.id("users"), toolCallId: v.string(), path: v.string(), input: v.string(), subject: v.optional(v.string()) },
  returns: v.id("assistantSteps"),
  handler: async (ctx, args) => ctx.db.insert("assistantSteps", { ...args, status: "running", startedAt: Date.now() }),
});

/** A step that read something ends with its result. A change ends its own (`endStep`). */
export const read = internalMutation({
  // `result` is what the action returned, as JSON.
  args: { stepId: v.id("assistantSteps"), result: v.string() },
  returns: v.null(),
  handler: async (ctx, { stepId, result }) => {
    await endStep(ctx, stepId, JSON.parse(result));
    return null;
  },
});

/** A step fails, with why, as the model is told. */
export const failed = internalMutation({
  args: { stepId: v.id("assistantSteps"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { stepId, error }) => {
    if (await ctx.db.get("assistantSteps", stepId)) await ctx.db.patch("assistantSteps", stepId, { status: "failed", error: cut(error, STEP_TEXT_MAX), endedAt: Date.now() });
    return null;
  },
});

/** Deletes a deleted chat's steps and their results, a batch at a time, until none are left. */
export const forget = internalMutation({
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const results = await ctx.db.query("assistantStepResults").withIndex("by_thread", (q) => q.eq("threadId", threadId)).take(FORGET_RESULTS);
    for (const row of results) await ctx.db.delete("assistantStepResults", row._id);
    // Steps go once their results are gone, so a batch never reads large rows and small ones together.
    const steps = results.length === FORGET_RESULTS ? [] : await ctx.db.query("assistantSteps").withIndex("by_thread_and_order", (q) => q.eq("threadId", threadId)).take(FORGET_STEPS);
    for (const step of steps) await ctx.db.delete("assistantSteps", step._id);
    if (results.length === FORGET_RESULTS || steps.length === FORGET_STEPS) await ctx.scheduler.runAfter(0, internal.assistant.steps.forget, { threadId });
    return null;
  },
});
