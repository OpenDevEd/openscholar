import { query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { modelSummary, presetPick } from "../ai/serverModel";
import { AI_TASKS, PRESET_KEYS, type PresetKey } from "../../lib/ai/tasks";
import { presetKeyValidator, presetPicksValidator, taskPicksValidator } from "./validators";

/** What a preset runs every task on. A null model means nothing live is set. */
const picksOf = (ctx: QueryCtx, preset: PresetKey) =>
  Promise.all(
    AI_TASKS.map(async (task) => {
      const pick = await presetPick(ctx, preset, task);
      return { task, model: await modelSummary(ctx, pick?.modelId ?? null), effort: pick?.effort ?? null };
    }),
  );

/** What each preset runs every task on, a field per preset. */
export const presetPicks = query({
  args: {},
  returns: presetPicksValidator,
  handler: async (ctx) => {
    const [cheap, fast, balanced, intelligent] = await Promise.all((["cheap", "fast", "balanced", "intelligent"] as const).map((preset) => picksOf(ctx, preset)));
    return { cheap, fast, balanced, intelligent };
  },
});

/** Kept for one release, while the deployed site still calls it; `presetPicks` replaces it. */
export const presets = query({
  args: {},
  returns: v.array(v.object({ preset: presetKeyValidator, tasks: taskPicksValidator })),
  handler: async (ctx) => await Promise.all(PRESET_KEYS.map(async (preset) => ({ preset, tasks: await picksOf(ctx, preset) }))),
});
