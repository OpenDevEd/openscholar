import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { aiTaskValidator, effortValidator, modelChoiceValidator } from "../aiModelConfig/validators";
import { requireAuth } from "../lib/auth";
import { requireAvailableModel, requireEffort } from "../models/catalog";
import { resolveTaskPick, userAiConfig } from "../ai/serverModel";
import { AI_TASKS } from "../../lib/ai/tasks";
import type { Doc } from "../_generated/dataModel";

/**
 * Switch to a preset or to Custom. Custom keeps its earlier picks; the first
 * time, it starts as a copy of what the user was running.
 */
export const choose = mutation({
  args: { choice: modelChoiceValidator },
  returns: v.null(),
  handler: async (ctx, { choice }) => {
    const user = await requireAuth(ctx);
    const cfg = await userAiConfig(ctx, user._id);
    let custom = cfg?.custom;
    if (choice === "custom" && !custom) {
      const picks = await Promise.all(AI_TASKS.map(async (task) => [task, await resolveTaskPick(ctx, user._id, task)] as const));
      custom = Object.fromEntries(picks.filter(([, pick]) => pick !== null)) as NonNullable<Doc<"userAiConfig">["custom"]>;
    }
    const fields = { choice, custom, updatedAt: Date.now() };
    if (cfg) await ctx.db.patch("userAiConfig", cfg._id, fields);
    else await ctx.db.insert("userAiConfig", { userId: user._id, ...fields });
    return null;
  },
});

/** Set Custom's model and effort for some tasks, and switch to Custom. */
export const setCustom = mutation({
  args: {
    picks: v.array(v.object({ task: aiTaskValidator, modelId: v.id("models"), effort: v.optional(effortValidator) })),
  },
  returns: v.null(),
  handler: async (ctx, { picks }) => {
    const user = await requireAuth(ctx);
    for (const pick of picks) requireEffort(await requireAvailableModel(ctx, pick.modelId), pick.effort);
    const cfg = await userAiConfig(ctx, user._id);
    const custom = { ...cfg?.custom };
    for (const { task, modelId, effort } of picks) custom[task] = effort ? { modelId, effort } : { modelId };
    const fields = { choice: "custom" as const, custom, updatedAt: Date.now() };
    if (cfg) await ctx.db.patch("userAiConfig", cfg._id, fields);
    else await ctx.db.insert("userAiConfig", { userId: user._id, ...fields });
    return null;
  },
});
