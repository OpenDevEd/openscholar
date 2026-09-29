import { v } from "convex/values";
import { AI_TASKS, SEARCH_TASKS } from "../../lib/ai/tasks";
import { PRESET_KEYS } from "../../lib/ai/resolve-server-model";

export const aiTaskValidator = v.union(...AI_TASKS.map((task) => v.literal(task)));
export const searchTaskValidator = v.union(...SEARCH_TASKS.map((task) => v.literal(task)));
export const presetKeyValidator = v.union(...PRESET_KEYS.map((preset) => v.literal(preset)));
export const serverPresetValidator = v.union(presetKeyValidator, v.literal("custom"), v.literal("recommended"));

/** What the settings map shows for a model. */
export const modelSummaryValidator = v.object({
  _id: v.id("models"),
  modelId: v.string(),
  name: v.string(),
  inputPricePerMillion: v.number(),
  outputPricePerMillion: v.number(),
});
