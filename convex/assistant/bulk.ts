/**
 * A bulk change the assistant makes (#341): one action run on many records as one step, with
 * one undo. The person said so on 2026-10-05, after 58 saves filled a chat with 58 cards.
 *
 * The changes go a chunk a transaction. Each is the action's own mutation, run inside the
 * chunk's, so it does exactly what one call of it does, fails alone, and leaves what reverses
 * it in the same transaction as the change. Undoing the step runs those back, newest first,
 * a chunk at a time. Apart from ./batches.ts, which the registry loads, because this loads
 * the registry.
 */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { assistantPath } from "../lib/userActions";
import { messageOf } from "./failures";
import { undoOf } from "./steps";

/** Changes one transaction makes: each reads and writes a handful of rows, so these stay well inside one. */
export const CHUNK = 25;

const mutationAt = (path: string) => {
  const entry = USER_ACTIONS.find((candidate) => candidate.path === path);
  return entry?.kind === "mutation" ? { entry, ref: makeFunctionReference<"mutation">(assistantPath(entry.path)) } : null;
};

/**
 * Makes one chunk of a bulk change's changes, as `userId`. `items` is what each is given, as
 * JSON. `approved`: the person was asked about the bulk change and said yes. `key` names the
 * chunk, and with a change's place in it fills the action's retry key. Returns how many were
 * made, how many couldn't be, and why the first of those couldn't.
 */
export const apply = internalMutation({
  args: { userId: v.id("users"), stepId: v.id("assistantSteps"), path: v.string(), items: v.string(), approved: v.boolean(), key: v.string() },
  returns: v.object({ made: v.number(), failed: v.number(), why: v.optional(v.string()) }),
  handler: async (ctx, { userId, stepId, path, items, approved, key }) => {
    const step = await ctx.db.get("assistantSteps", stepId);
    const action = mutationAt(path);
    const each = (JSON.parse(items) as Record<string, unknown>[]).slice(0, CHUNK);
    // Its chat was deleted while it ran: nothing more is changed.
    if (!step || !action) return { made: 0, failed: each.length, why: "This couldn't be run any more." };
    let made = 0;
    let failed = 0;
    let why: string | undefined;
    for (const [at, item] of each.entries()) {
      try {
        const result: unknown = await ctx.runMutation(action.ref, { ...item, ...(action.entry.retryKey ? { [action.entry.retryKey]: `${key}:${at}` } : {}), userId, ...(approved ? { approved } : {}) });
        made += 1;
        const undo = undoOf(result);
        if (undo) await ctx.db.insert("assistantStepUndos", { threadId: step.threadId, stepId, ...undo });
      } catch (error) {
        // Its own writes were rolled back with it; the rest of the chunk goes on.
        failed += 1;
        why ??= messageOf(error);
      }
    }
    return { made, failed, ...(why ? { why } : {}) };
  },
});

/**
 * Reverses a chunk of a bulk change's changes, newest first, and goes on until none is left.
 * A change that was itself changed since refuses its undo, as it would alone, and stays.
 */
export const revert = internalMutation({
  args: { userId: v.id("users"), stepId: v.id("assistantSteps") },
  returns: v.null(),
  handler: async (ctx, { userId, stepId }) => {
    const rows = await ctx.db.query("assistantStepUndos").withIndex("by_step", (q) => q.eq("stepId", stepId)).order("desc").take(CHUNK);
    for (const row of rows) {
      const action = mutationAt(row.path);
      try {
        if (action) await ctx.runMutation(action.ref, { ...JSON.parse(row.args), ...(action.entry.retryKey ? { [action.entry.retryKey]: `undo:${row._id}` } : {}), userId, approved: true });
      } catch (error) {
        console.warn(`[assistant] one change of bulk step ${stepId} wasn't undone`, messageOf(error));
      }
      await ctx.db.delete("assistantStepUndos", row._id);
    }
    if (rows.length === CHUNK) await ctx.scheduler.runAfter(0, internal.assistant.bulk.revert, { userId, stepId });
    return null;
  },
});
