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
import { UNDONE_TOLD } from "./validators";

export const run = mutation({
  args: { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps") },
  returns: v.null(),
  handler: async (ctx, { threadId, stepId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, "assistant.enabled", userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    const step = await ctx.db.get("assistantSteps", stepId);
    if (!step || step.threadId !== threadId) throw createError("NOT_FOUND", "That step isn't in this chat.");
    // It changed that person's records, and the undo would act on whoever runs it.
    if (step.userId !== userId) throw createError("FORBIDDEN", "Only the person this was done for can undo it.");
    if (!step.undo || step.undone) throw createError("CONFLICT", "There's nothing left to undo here.");
    const entry = USER_ACTIONS.find((candidate) => candidate.path === step.undo!.path);
    if (!entry || entry.kind !== "mutation") throw createError("NOT_FOUND", "This can no longer be undone.");
    // The reversing action refuses on its own when the record has changed since (its `expect`).
    await ctx.runMutation(makeFunctionReference<"mutation">(assistantPath(entry.path)), { ...JSON.parse(step.undo.args), ...(entry.retryKey ? { [entry.retryKey]: `undo:${stepId}` } : {}), userId, approved: true });
    await ctx.db.patch("assistantSteps", stepId, { undone: true });
    // The assistant is told with this person's next message (./replies.ts). Past what the chat keeps, the earliest goes, counted for whoever's it was and not forgotten.
    const undone = [...(thread.undone ?? []), { userId, stepId }];
    const dropped = undone.length > UNDONE_TOLD ? undone.shift() : undefined;
    const more = thread.undoneMore ?? [];
    const counted = more.find((entry) => entry.userId === dropped?.userId);
    await ctx.db.patch("assistantThreads", threadId, {
      undone,
      ...(dropped ? { undoneMore: [...more.filter((entry) => entry !== counted), { userId: dropped.userId, count: (counted?.count ?? 0) + 1 }].slice(-UNDONE_TOLD) } : {}),
    });
    return null;
  },
});
