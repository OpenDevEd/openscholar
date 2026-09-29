import { internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { AI_TASKS, PRESET_KEYS, presetConfigKey, type AiTask, type PresetKey } from "../../lib/ai/tasks";
import type { Effort } from "../../lib/ai/core/call-options";

type Pick = { modelId: string; effort?: Effort };
const HEAVY: readonly AiTask[] = ["chat", "extraction", "screenAll"];
const FLASH_LITE = "google/gemini-3.1-flash-lite-preview";
const SONNET = "anthropic/claude-sonnet-4.6";

/**
 * Starting picks. Slugs must be catalog rows users can pick, or the resolver
 * skips them; admins change them in Settings, Admin, AI models.
 */
function defaultPick(preset: PresetKey, task: AiTask): Pick {
  switch (preset) {
    case "cheap":
      return { modelId: "deepseek/deepseek-v4.1-flash", effort: "low" };
    case "fast":
      return { modelId: FLASH_LITE, effort: "minimal" };
    case "balanced":
      return HEAVY.includes(task) && task !== "extraction" ? { modelId: SONNET, effort: "medium" } : { modelId: FLASH_LITE, effort: "low" };
    case "intelligent":
      return HEAVY.includes(task) ? { modelId: "anthropic/claude-opus-4.8", effort: "high" } : { modelId: SONNET, effort: "medium" };
  }
}

/** Writes a preset pick unless one exists; returns whether it wrote. */
async function insertPickIfMissing(ctx: MutationCtx, preset: PresetKey, task: AiTask, pick: Pick) {
  const key = presetConfigKey(preset, task);
  const existing = await ctx.db
    .query("aiModelConfig")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing) return false;
  await ctx.db.insert("aiModelConfig", { key, ...pick, updatedAt: Date.now() });
  return true;
}

/** Seeds every preset's starting picks. Idempotent: it never replaces a pick. */
export const seed = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let written = 0;
    for (const preset of PRESET_KEYS) {
      for (const task of AI_TASKS) {
        if (await insertPickIfMissing(ctx, preset, task, defaultPick(preset, task))) written++;
      }
    }
    return written;
  },
});
