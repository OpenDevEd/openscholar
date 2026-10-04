import { query } from "../_generated/server";
import { v } from "convex/values";
import { modelChoiceValidator } from "../aiModelConfig/validators";
import { taskPicksValidator } from "../aiModelConfig/validators";
import { livePick, modelSummary, userAiConfig } from "../ai/serverModel";
import { getCurrentUser } from "../lib/auth";
import { AI_TASKS } from "../../lib/ai/tasks";

/**
 * The signed-in user's choice and Custom picks, or null when signed out or
 * never set (the default preset). A pick whose model is gone shows as null.
 */
export const get = query({
  args: {},
  returns: v.union(v.null(), v.object({ choice: modelChoiceValidator, custom: taskPicksValidator })),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const cfg = user ? await userAiConfig(ctx, user._id) : null;
    if (!cfg) return null;
    return {
      choice: cfg.choice,
      custom: await Promise.all(
        AI_TASKS.map(async (task) => {
          const pick = await livePick(ctx, cfg.custom?.[task], task);
          return { task, model: await modelSummary(ctx, pick?.modelId ?? null), effort: pick?.effort ?? null };
        }),
      ),
    };
  },
});
