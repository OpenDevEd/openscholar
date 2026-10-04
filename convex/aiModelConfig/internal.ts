import { internalMutation, type MutationCtx } from "../lib/functions";
import { v } from "convex/values";
import { AI_TASKS, DECISION_TASKS, PRESET_KEYS, presetConfigKey, type AiTask, type PresetKey } from "../../lib/ai/tasks";
import { JEV_MODEL } from "../../lib/ai/decisions";
import type { Effort } from "../../lib/ai/core/call-options";

type Pick = { modelId: string; effort?: Effort };
const HEAVY: readonly AiTask[] = ["chat", "extraction"];
const FLASH_LITE = "google/gemini-3.1-flash-lite-preview";
const SONNET = "anthropic/claude-sonnet-4.6";
/** What chat and the assistant run on unless a person picks otherwise: it drives the assistant's tools reliably at a fraction of a larger model's cost. */
const LUNA = "openai/gpt-6-luna";

/**
 * Starting picks. Slugs must be catalog rows users can pick, or the resolver
 * skips them; admins change them in Settings, Admin, AI models.
 */
function defaultPick(preset: PresetKey, task: AiTask): Pick {
  // Every preset screens with Jev: yes/no answers at a fraction of a text model's cost.
  if (DECISION_TASKS.includes(task)) return { modelId: JEV_MODEL };
  switch (preset) {
    case "cheap":
      return { modelId: "deepseek/deepseek-v4.1-flash", effort: "low" };
    case "fast":
      return { modelId: FLASH_LITE, effort: "minimal" };
    case "balanced":
      return task === "chat" ? { modelId: LUNA, effort: "medium" } : { modelId: FLASH_LITE, effort: "low" };
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
