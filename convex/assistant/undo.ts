/**
 * Undo for a step the assistant took (#342): runs the reversing action the step kept, as
 * the person it was done for. Apart from ./steps.ts, because it loads the action registry.
 */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { mutation } from "../lib/functions";
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
    // The last change made is put back first: calls run together, so one that started first may have ended last.
    // All in this one transaction, so a run is undone whole or, where one of its changes can't be, not at all.
    steps.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
    let { undone = [], undoneMore = [] } = thread;
    for (const step of steps) {
      const entry = USER_ACTIONS.find((candidate) => candidate.path === step.undo.path);
      if (!entry || entry.kind !== "mutation") throw createError("NOT_FOUND", "This can no longer be undone.");
      // The reversing action refuses on its own when the record has changed since (its `expect`).
      await ctx.runMutation(makeFunctionReference<"mutation">(assistantPath(entry.path)), { ...JSON.parse(step.undo.args), ...(entry.retryKey ? { [entry.retryKey]: `undo:${step._id}` } : {}), userId, workspaceId: step.workspaceId, approved: true });
      await ctx.db.patch("assistantSteps", step._id, { undone: true });
      // The assistant is told with this person's next message (./replies.ts). Past what the chat keeps, the earliest goes, counted for whoever's it was and not forgotten.
      undone = [...undone, { userId, stepId: step._id }];
      const dropped = undone.length > UNDONE_TOLD ? undone.shift() : undefined;
      if (dropped) {
        const counted = undoneMore.find((kept) => kept.userId === dropped.userId);
        undoneMore = [...undoneMore.filter((kept) => kept !== counted), { userId: dropped.userId, count: (counted?.count ?? 0) + 1 }].slice(-UNDONE_TOLD);
      }
    }
    await ctx.db.patch("assistantThreads", threadId, { undone, ...(undoneMore.length ? { undoneMore } : {}) });
    return null;
  },
});
