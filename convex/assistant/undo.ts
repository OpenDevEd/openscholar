/**
 * Undo for a step the assistant took (#342): runs the reversing action the step kept, as
 * the person it was done for. Apart from ./steps.ts, because it loads the action registry.
 */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { action, internalMutation, internalQuery, mutation } from "../lib/functions";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { assistantPath } from "../lib/userActions";
import { requireThread } from "./access";
import { STEPS_SHOWN } from "../../lib/assistant/steps";
import { UNDONE_TOLD } from "./validators";

export const run = mutation({
  // `stepIds`: one step, or a folded card's run of them (lib/assistant/step-cards.ts `runsOf`), undone together.
  args: { threadId: v.id("assistantThreads"), stepIds: v.array(v.id("assistantSteps")) },
  returns: v.null(),
  handler: async (ctx, { threadId, stepIds }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, "assistant.enabled", userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    const ids = [...new Set(stepIds)];
    if (!ids.length || ids.length > STEPS_SHOWN) throw createError("VALIDATION_ERROR", `Undo between 1 and ${STEPS_SHOWN} steps at once.`);
    const steps = [];
    for (const id of ids) {
      const step = await ctx.db.get("assistantSteps", id);
      if (!step || step.threadId !== threadId) throw createError("NOT_FOUND", "That step isn't in this chat.");
      // It changed that person's records, and the undo would act on whoever runs it.
      if (step.userId !== userId) throw createError("FORBIDDEN", "Only the person this was done for can undo it.");
      if (!step.undo || step.undone) throw createError("CONFLICT", "There's nothing left to undo here.");
      steps.push({ ...step, undo: step.undo });
    }
    // The last change made is put back first: calls run together, so one that started first may have ended last. Two that
    // ended in the same moment go by which started later, as the later of two such changes is the one that builds on the other.
    // All in this one transaction, so a run is undone whole or, where one of its changes can't be, not at all.
    steps.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt) || b._creationTime - a._creationTime);
    for (const step of steps) {
      const entry = USER_ACTIONS.find((candidate) => candidate.path === step.undo.path);
      // One whose undo reaches outside runs on its own (`runAction`).
      if (!entry || entry.kind !== "mutation") throw createError("NOT_FOUND", "This can no longer be undone.");
      // The reversing action refuses on its own when the record has changed since (its `expect`).
      await ctx.runMutation(makeFunctionReference<"mutation">(assistantPath(entry.path)), { ...JSON.parse(step.undo.args), ...(entry.retryKey ? { [entry.retryKey]: `undo:${step._id}` } : {}), userId, workspaceId: step.workspaceId, approved: true });
    }
    await noteUndone(ctx, thread, userId, steps);
    return null;
  },
});

/** Marks steps undone, and keeps them for the assistant to be told with this person's next message (./replies.ts). */
async function noteUndone(ctx: MutationCtx, thread: Doc<"assistantThreads">, userId: Id<"users">, steps: Array<Pick<Doc<"assistantSteps">, "_id">>) {
  let { undone = [], undoneMore = [] } = thread;
  for (const step of steps) {
    await ctx.db.patch("assistantSteps", step._id, { undone: true });
    // Past what the chat keeps, the earliest goes, counted for whoever's it was and not forgotten.
    undone = [...undone, { userId, stepId: step._id }];
    const dropped = undone.length > UNDONE_TOLD ? undone.shift() : undefined;
    if (dropped) {
      const counted = undoneMore.find((kept) => kept.userId === dropped.userId);
      undoneMore = [...undoneMore.filter((kept) => kept !== counted), { userId: dropped.userId, count: (counted?.count ?? 0) + 1 }].slice(-UNDONE_TOLD);
    }
  }
  await ctx.db.patch("assistantThreads", thread._id, { undone, ...(undoneMore.length ? { undoneMore } : {}) });
}

/** Steps whose undo reaches outside, as the person asking may undo them: each one's reversal and where it runs, the last made first, as `run` orders them. */
export const outsideUndo = internalQuery({
  args: { threadId: v.id("assistantThreads"), stepIds: v.array(v.id("assistantSteps")) },
  returns: v.array(v.object({ stepId: v.id("assistantSteps"), userId: v.id("users"), workspaceId: v.id("workspaces"), path: v.string(), args: v.string() })),
  handler: async (ctx, { threadId, stepIds }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, "assistant.enabled", userId);
    await requireThread(ctx, userId, threadId);
    const ids = [...new Set(stepIds)];
    if (!ids.length || ids.length > STEPS_SHOWN) throw createError("VALIDATION_ERROR", `Undo between 1 and ${STEPS_SHOWN} steps at once.`);
    const steps = [];
    for (const id of ids) {
      const step = await ctx.db.get("assistantSteps", id);
      if (!step || step.threadId !== threadId) throw createError("NOT_FOUND", "That step isn't in this chat.");
      if (step.userId !== userId) throw createError("FORBIDDEN", "Only the person this was done for can undo it.");
      if (!step.undo?.action || step.undone) throw createError("CONFLICT", "There's nothing left to undo here.");
      steps.push({ ...step, undo: step.undo });
    }
    steps.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt) || b._creationTime - a._creationTime);
    return steps.map((step) => ({ stepId: step._id, userId, workspaceId: step.workspaceId, path: step.undo.path, args: step.undo.args }));
  },
});

/** Marks a step undone once its reversal outside has run, unless it was undone meanwhile. */
export const outsideUndone = internalMutation({
  args: { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { threadId, stepId, userId }) => {
    const [thread, step] = await Promise.all([ctx.db.get("assistantThreads", threadId), ctx.db.get("assistantSteps", stepId)]);
    if (thread && step && !step.undone) await noteUndone(ctx, thread, userId, [step]);
    return null;
  },
});

/**
 * Undo for steps whose change reached outside the account (an Evidence Library's collection, Clerk, Autumn): each one's
 * reversing action, as the person it was done for, the last made first. An action runs them, and no single transaction
 * holds them: each step is marked undone once its reversal has run, and one that fails, such as one whose record was
 * changed since (its `expect`), stops the rest with why.
 */
export const runAction = action({
  args: { threadId: v.id("assistantThreads"), stepIds: v.array(v.id("assistantSteps")) },
  returns: v.null(),
  handler: async (ctx, { threadId, stepIds }) => {
    const found: Array<{ stepId: Id<"assistantSteps">; userId: Id<"users">; workspaceId: Id<"workspaces">; path: string; args: string }> = await ctx.runQuery(internal.assistant.undo.outsideUndo, { threadId, stepIds });
    for (const step of found) {
      const entry = USER_ACTIONS.find((candidate) => candidate.path === step.path);
      if (!entry || entry.kind !== "action") throw createError("NOT_FOUND", "This can no longer be undone.");
      await ctx.runAction(makeFunctionReference<"action">(assistantPath(entry.path)), { ...JSON.parse(step.args), userId: step.userId, workspaceId: step.workspaceId, approved: true });
      await ctx.runMutation(internal.assistant.undo.outsideUndone, { threadId, stepId: step.stepId, userId: step.userId });
    }
    return null;
  },
});
