import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { AI_TASKS, PRESET_KEYS, type AiTask, type ModelChoice, type PresetKey } from "../../lib/ai/tasks";
import { defaultPick, insertPickIfMissing } from "../aiModelConfig/internal";

// ponytail: aiModelConfig holds a few dozen curated rows, so one read covers it.
const MAX_CONFIG_ROWS = 500;

/**
 * Moves shared dev from the single-model choice to per-task preset maps. Run
 * once per deployment:  npx convex run migrations/presetMaps:run
 *
 * - Old rows become preset maps: `task.<task>` and `preset.balanced` fill
 *   Balanced; `preset.fast` and `preset.intelligent` fill every task of theirs.
 *   Anything still missing gets its default. The old rows are then deleted.
 * - Each user's Recommended becomes Balanced; One model becomes Custom with
 *   that model on every task.
 * Idempotent; the user pass schedules its own next page.
 */
export const run = internalMutation({
  args: {},
  returns: v.object({ picksWritten: v.number(), oldRowsDeleted: v.number() }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("aiModelConfig").take(MAX_CONFIG_ROWS);
    const old = (key: string) => rows.find((row) => row.key === key)?.modelId;
    const derived = (preset: PresetKey, task: AiTask) =>
      preset === "balanced" ? (old(`task.${task}`) ?? old("preset.balanced")) : preset === "cheap" ? undefined : old(`preset.${preset}`);

    let picksWritten = 0;
    for (const preset of PRESET_KEYS) {
      for (const task of AI_TASKS) {
        const fallback = defaultPick(preset, task);
        const modelId = derived(preset, task);
        // A migrated model keeps its default effort only if it's the default model.
        const pick = modelId && modelId !== fallback.modelId ? { modelId } : fallback;
        if (await insertPickIfMissing(ctx, preset, task, pick)) picksWritten++;
      }
    }

    const obsolete = rows.filter((row) => row.key.startsWith("task.") || row.key.startsWith("default.") || /^preset\.[a-z]+$/.test(row.key));
    for (const row of obsolete) await ctx.db.delete("aiModelConfig", row._id);

    await ctx.scheduler.runAfter(0, internal.migrations.presetMaps.users, { cursor: null });
    return { picksWritten, oldRowsDeleted: obsolete.length };
  },
});

function migrated(cfg: Doc<"userAiConfig">): { choice: ModelChoice; custom?: Doc<"userAiConfig">["custom"] } {
  if (cfg.serverPreset === "custom" && cfg.serverModelId) {
    const pick = { modelId: cfg.serverModelId };
    return { choice: "custom", custom: Object.fromEntries(AI_TASKS.map((task) => [task, pick])) };
  }
  return { choice: cfg.serverPreset === "fast" || cfg.serverPreset === "intelligent" ? cfg.serverPreset : "balanced" };
}

export const users = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ migrated: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("userAiConfig").paginate({ numItems: 200, cursor });
    let count = 0;
    for (const cfg of page.page) {
      if (cfg.choice !== undefined) continue;
      await ctx.db.patch("userAiConfig", cfg._id, { ...migrated(cfg), serverPreset: undefined, serverModelId: undefined, updatedAt: Date.now() });
      count++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.presetMaps.users, { cursor: page.continueCursor });
    return { migrated: count, isDone: page.isDone };
  },
});
