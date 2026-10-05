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
import { internalAction, internalMutation } from "../lib/functions";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { assistantPath } from "../lib/userActions";
import { messageOf } from "./failures";
import { UNDO_BULK, undoOf } from "./steps";

/**
 * Changes one transaction makes at most. Most read and write a handful of rows. One that
 * reads a lot (a removal looks in each of the person's collections) can fill a transaction
 * with fewer, so a chunk that doesn't fit is tried again at half the size.
 */
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
 *
 * The step says how many it has made, and holds its undo, from its first change on: a reply
 * that dies between two chunks leaves a step that tells the truth and can still be undone.
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
    if (made) await ctx.db.patch("assistantSteps", stepId, { count: (step.count ?? 0) + made, undo: { path: UNDO_BULK, args: JSON.stringify({ change: stepId }) } });
    return { made, failed, ...(why ? { why } : {}) };
  },
});

/**
 * Reverses the newest `size` of a bulk change's changes. A change that was itself changed
 * since refuses its undo, as it would alone, and stays as it is. With `skip`, the newest is
 * given up on without being run: its reversal alone doesn't fit a transaction.
 */
export const revertChunk = internalMutation({
  args: { userId: v.id("users"), stepId: v.id("assistantSteps"), size: v.number(), skip: v.optional(v.boolean()) },
  returns: v.object({ reversed: v.number(), refused: v.number(), why: v.optional(v.string()), more: v.boolean() }),
  handler: async (ctx, { userId, stepId, size, skip }) => {
    const rows = await ctx.db.query("assistantStepUndos").withIndex("by_step", (q) => q.eq("stepId", stepId)).order("desc").take(Math.min(size, CHUNK));
    let reversed = 0;
    let refused = 0;
    let why: string | undefined;
    for (const row of rows) {
      const action = mutationAt(row.path);
      try {
        if (skip || !action) throw new Error("This can no longer be undone.");
        await ctx.runMutation(action.ref, { ...JSON.parse(row.args), ...(action.entry.retryKey ? { [action.entry.retryKey]: `undo:${row._id}` } : {}), userId, approved: true });
        reversed += 1;
      } catch (error) {
        refused += 1;
        why ??= messageOf(error);
      }
      await ctx.db.delete("assistantStepUndos", row._id);
    }
    return { reversed, refused, ...(why ? { why } : {}), more: rows.length === Math.min(size, CHUNK) };
  },
});

/** What undoing a bulk change came to, kept on its step: what couldn't be put back is said there, where the person pressed Undo. */
export const reverted = internalMutation({
  args: { stepId: v.id("assistantSteps"), reversed: v.number(), refused: v.number(), why: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { stepId, reversed, refused, why }) => {
    // Its chat was deleted meanwhile: there's no step left to say it on.
    if (!refused || !(await ctx.db.get("assistantSteps", stepId))) return null;
    const many = reversed ? `${refused.toLocaleString("en")} of these couldn't be put back` : "None of these could be put back";
    await ctx.db.patch("assistantSteps", stepId, { error: `${many}. ${why ?? ""}`.trim() });
    return null;
  },
});

/** Undoes a bulk change: its changes are reversed newest first, a chunk a transaction, until none is left. */
export const revert = internalAction({
  args: { userId: v.id("users"), stepId: v.id("assistantSteps") },
  returns: v.null(),
  handler: async (ctx, { userId, stepId }) => {
    let size = CHUNK;
    let [reversed, refused] = [0, 0];
    let why: string | undefined;
    for (;;) {
      // Typed here: the generated API's types depend on this module, so inference would loop.
      let done: { reversed: number; refused: number; why?: string; more: boolean };
      try {
        done = await ctx.runMutation(internal.assistant.bulk.revertChunk, { userId, stepId, size });
      } catch (error) {
        // A chunk that doesn't fit one transaction is tried again at half the size. One reversal that doesn't fit alone is given up on.
        if (size > 1) {
          size = Math.ceil(size / 2);
          continue;
        }
        console.warn(`[assistant] one change of bulk step ${stepId} couldn't be undone`, messageOf(error));
        done = await ctx.runMutation(internal.assistant.bulk.revertChunk, { userId, stepId, size: 1, skip: true });
      }
      reversed += done.reversed;
      refused += done.refused;
      why ??= done.why;
      if (!done.more) break;
    }
    await ctx.runMutation(internal.assistant.bulk.reverted, { stepId, reversed, refused, ...(why ? { why } : {}) });
    return null;
  },
});
