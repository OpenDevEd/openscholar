/**
 * A bulk change the assistant makes (#341): one action run on many records as one step, with
 * one undo. The person said so on 2026-10-05, after 58 saves filled a chat with 58 cards.
 *
 * The changes go a chunk a transaction. Each is the action's own mutation, run inside the
 * chunk's, so it does exactly what one call of it does, fails alone, and leaves what reverses
 * it in the same transaction as the change. Undoing the step runs those back, newest first,
 * a few a transaction, each transaction scheduling the next as it commits: an undo the person
 * pressed is finished whatever else happens. Apart from ./batches.ts, which the registry
 * loads, because this loads the registry.
 */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
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

/** Reversals one transaction runs. Few, so a reversal that reads a lot still fits, and the next start on a fresh transaction. */
const REVERT = 5;
/** Convex's words for a transaction that has read or written all it may. */
const FULL = /too many|limit:|too large/i;
/** Whether a change failed for want of room in its transaction: the changes before it used the room. Alone, in a fresh one, it may fit. */
const outOfRoom = (error: unknown) => FULL.test(error instanceof Error ? error.message : String(error));

const mutationAt = (path: string) => {
  const entry = USER_ACTIONS.find((candidate) => candidate.path === path);
  return entry?.kind === "mutation" ? { entry, ref: makeFunctionReference<"mutation">(assistantPath(entry.path)) } : null;
};

/**
 * Makes one chunk of a bulk change's changes, as `userId`. `items` is what each is given, as
 * JSON. `approved`: the person was asked about the bulk change and said yes. `key` names the
 * chunk, and with a change's place in it fills the action's retry key. Returns how many of
 * them it got through (`took`), how many of those were made, how many couldn't be, and why
 * the first of those couldn't. A change the transaction had no room left for ends the chunk
 * there, to be the first of the next.
 *
 * The step says how many it has made, and holds its undo, from its first change on: a reply
 * that dies between two chunks leaves a step that tells the truth and can still be undone.
 * A change with no undo of its own (a save over a rating kept on search cards) is kept as
 * one, so undoing the step says it stayed.
 */
export const apply = internalMutation({
  args: { userId: v.id("users"), stepId: v.id("assistantSteps"), path: v.string(), items: v.string(), approved: v.boolean(), key: v.string() },
  returns: v.object({ took: v.number(), made: v.number(), failed: v.number(), why: v.optional(v.string()) }),
  handler: async (ctx, { userId, stepId, path, items, approved, key }) => {
    const step = await ctx.db.get("assistantSteps", stepId);
    const action = mutationAt(path);
    const each = (JSON.parse(items) as Record<string, unknown>[]).slice(0, CHUNK);
    // Its chat was deleted while it ran, or the step has ended since: nothing more is changed.
    if (!step || step.status !== "running" || step.undone || !action) return { took: each.length, made: 0, failed: each.length, why: "This couldn't be run any more." };
    let [took, made, failed, reversible] = [0, 0, 0, 0];
    let why: string | undefined;
    for (const [at, item] of each.entries()) {
      try {
        const result: unknown = await ctx.runMutation(action.ref, { ...item, ...(action.entry.retryKey ? { [action.entry.retryKey]: `${key}:${at}` } : {}), userId, ...(approved ? { approved } : {}) });
        made += 1;
        const undo = undoOf(result);
        if (undo) reversible += 1;
        await ctx.db.insert("assistantStepUndos", { threadId: step.threadId, stepId, ...(undo ?? { path: "", args: "{}" }) });
      } catch (error) {
        // The changes before it left it no room: it starts the next chunk. Alone in this one, it can't be made at all.
        if (at > 0 && outOfRoom(error)) break;
        // Its own writes were rolled back with it; the rest of the chunk goes on.
        failed += 1;
        why ??= messageOf(error);
      }
      took += 1;
    }
    // Undo is offered once there's a change it can take back.
    if (made) await ctx.db.patch("assistantSteps", stepId, { count: (step.count ?? 0) + made, ...(reversible || step.undo ? { undo: { path: UNDO_BULK, args: JSON.stringify({ change: stepId }) } } : {}) });
    return { took, made, failed, ...(why ? { why } : {}) };
  },
});

/**
 * Reverses the newest of a bulk change's changes, and schedules itself for the rest in the
 * same transaction, so a reversal once begun can't lose its place. A change that was itself
 * changed since refuses its undo, as it would alone, and stays as it is; so does one that had
 * no undo. `reversed`, `refused` and `why` are what the transactions before this one came to.
 * When none is left, the step says what couldn't be put back, where the person pressed Undo.
 */
export const revert = internalMutation({
  args: { userId: v.id("users"), stepId: v.id("assistantSteps"), reversed: v.number(), refused: v.number(), why: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { userId, stepId, ...before }) => {
    let { reversed, refused, why } = before;
    const left = () => ctx.db.query("assistantStepUndos").withIndex("by_step", (q) => q.eq("stepId", stepId)).order("desc");
    for (const [at, row] of (await left().take(REVERT)).entries()) {
      const action = mutationAt(row.path);
      try {
        if (!action) throw createError("CONFLICT", "This change has no undo.");
        await ctx.runMutation(action.ref, { ...JSON.parse(row.args), ...(action.entry.retryKey ? { [action.entry.retryKey]: `undo:${row._id}` } : {}), userId, approved: true });
        reversed += 1;
      } catch (error) {
        // The reversals before it left it no room: it's the first of the next transaction.
        if (at > 0 && outOfRoom(error)) break;
        refused += 1;
        why ??= messageOf(error);
      }
      await ctx.db.delete("assistantStepUndos", row._id);
    }
    if (await left().first()) {
      await ctx.scheduler.runAfter(0, internal.assistant.bulk.revert, { userId, stepId, reversed, refused, ...(why ? { why } : {}) });
      return null;
    }
    // Its chat may have been deleted meanwhile: the changes are put back all the same, with no step left to say so on.
    if (!(await ctx.db.get("assistantSteps", stepId))) return null;
    const many = reversed ? `${refused.toLocaleString("en")} of these couldn't be put back` : "None of these could be put back";
    await ctx.db.patch("assistantSteps", stepId, { reverting: undefined, ...(refused ? { error: `${many}. ${why ?? ""}`.trim() } : {}) });
    return null;
  },
});
