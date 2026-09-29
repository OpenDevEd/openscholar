import { v } from "convex/values";
import { AI_TASKS, PRESET_KEYS, SEARCH_TASKS, type AiTask } from "../../lib/ai/tasks";
import { EFFORTS } from "../../lib/ai/core/call-options";

export const aiTaskValidator = v.union(...AI_TASKS.map((task) => v.literal(task)));
export const searchTaskValidator = v.union(...SEARCH_TASKS.map((task) => v.literal(task)));
export const presetKeyValidator = v.union(...PRESET_KEYS.map((preset) => v.literal(preset)));
export const effortValidator = v.union(...EFFORTS.map((effort) => v.literal(effort)));
export const modelChoiceValidator = v.union(presetKeyValidator, v.literal("custom"));

/** A model and the effort it runs at; no effort means the model's own default. */
export const taskPickValidator = v.object({ modelId: v.id("models"), effort: v.optional(effortValidator) });
const optionalPick = v.optional(taskPickValidator);
const customPickFields: Record<AiTask, typeof optionalPick> = {
  chat: optionalPick,
  extraction: optionalPick,
  screenAll: optionalPick,
  screening: optionalPick,
  questionToQuery: optionalPick,
  refine: optionalPick,
  translate: optionalPick,
  broadenNarrow: optionalPick,
};
/** Custom's pick for each task. */
export const customPicksValidator = v.object(customPickFields);

/** What the settings map shows for a model. */
export const modelSummaryValidator = v.object({
  _id: v.id("models"),
  modelId: v.string(),
  name: v.string(),
  inputPricePerMillion: v.number(),
  outputPricePerMillion: v.number(),
  reasoningEfforts: v.optional(v.array(effortValidator)),
  defaultEffort: v.optional(effortValidator),
  reasoningMandatory: v.optional(v.boolean()),
});
