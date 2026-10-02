import { query } from "../_generated/server";
import { v } from "convex/values";
import { modelSummary, presetPick } from "../ai/serverModel";
import { AI_TASKS, PRESET_KEYS } from "../../lib/ai/tasks";
import { presetKeyValidator, taskPicksValidator } from "./validators";


/** What each preset runs every task on. A null model means nothing live is set. */
export const presets = query({
  args: {},
  returns: v.array(v.object({ preset: presetKeyValidator, tasks: taskPicksValidator })),
  handler: async (ctx) =>
    await Promise.all(
      PRESET_KEYS.map(async (preset) => ({
        preset,
        tasks: await Promise.all(
          AI_TASKS.map(async (task) => {
            const pick = await presetPick(ctx, preset, task);
            return { task, model: await modelSummary(ctx, pick?.modelId ?? null), effort: pick?.effort ?? null };
          }),
        ),
      })),
    ),
});
