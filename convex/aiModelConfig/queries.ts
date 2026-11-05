import { query, type QueryCtx } from "../_generated/server";
import { modelSummary, presetPick } from "../ai/serverModel";
import { AI_TASKS, type PresetKey } from "../../lib/ai/tasks";
import { presetPicksValidator } from "./validators";

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

