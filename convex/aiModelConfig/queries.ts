import { query } from "../_generated/server";
import { configModelId, modelSummary, recommendedModelId } from "../ai/serverModel";
import { AI_TASKS } from "../../lib/ai/tasks";
import { PRESET_KEYS } from "../../lib/ai/resolve-server-model";
import { aiTaskValidator, modelSummaryValidator, presetKeyValidator } from "./validators";
import { v } from "convex/values";

/**
 * All curated model-config rows (small table — presets + per-provider defaults).
 * The client joins each `modelId` to the `models` catalog for live pricing/desc.
 */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      modelId: v.string(),
      label: v.union(v.string(), v.null()),
      blurb: v.union(v.string(), v.null()),
      sortOrder: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("aiModelConfig").collect();
    return rows.map((r) => ({
      key: r.key,
      modelId: r.modelId,
      label: r.label ?? null,
      blurb: r.blurb ?? null,
      sortOrder: r.sortOrder ?? null,
    }));
  },
});

/**
 * What Recommended runs each task on, and the models behind the chat
 * shortcuts. Null where nothing live is configured.
 */
export const routing = query({
  args: {},
  returns: v.object({
    tasks: v.array(v.object({ task: aiTaskValidator, model: v.union(modelSummaryValidator, v.null()) })),
    presets: v.array(v.object({ preset: presetKeyValidator, model: v.union(modelSummaryValidator, v.null()) })),
  }),
  handler: async (ctx) => ({
    tasks: await Promise.all(
      AI_TASKS.map(async (task) => ({ task, model: await modelSummary(ctx, await recommendedModelId(ctx, task)) })),
    ),
    presets: await Promise.all(
      PRESET_KEYS.map(async (preset) => ({ preset, model: await modelSummary(ctx, await configModelId(ctx, `preset.${preset}`)) })),
    ),
  }),
});
