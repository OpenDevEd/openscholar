/**
 * Undo for a bulk change the assistant made (./bulk.ts): one action for the person's Undo
 * and for the assistant, which is given it as the bulk change's `undo`.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantMutation, defineUserMutation, userMutation } from "../lib/userActions";

export const undoAction = defineUserMutation({
  path: "assistant/batches:undo",
  description:
    "Undoes a bulk change made in a chat, all of it at once: every change it made that hasn't been changed again since. `change` is the one a bulk change's result gives as its `undo`. " +
    "It can't be redone: to make the changes again, make them again.",
  args: { change: v.id("assistantSteps") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  // Undoing has no undo of its own.
  undoable: false,
  run: async (ctx, userId, { change }) => {
    const step = await ctx.db.get("assistantSteps", change);
    // It changed that person's records, and the undo would act on whoever runs it.
    if (!step || step.userId !== userId || step.batch === undefined) throw createError("NOT_FOUND", "That bulk change isn't one of yours.");
    if (step.undone) throw createError("CONFLICT", "There's nothing left to undo here.");
    await ctx.db.patch("assistantSteps", change, { undone: true });
    await ctx.scheduler.runAfter(0, internal.assistant.bulk.revert, { userId, stepId: change });
    return null;
  },
});
export const undo = userMutation(undoAction);
export const undoForAssistant = assistantMutation(undoAction);
