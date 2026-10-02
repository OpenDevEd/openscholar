import { v } from "convex/values";
import { AI_TASKS, PRESET_KEYS, SEARCH_TASKS, type AiTask } from "../../lib/ai/tasks";
import { EFFORTS } from "../../lib/ai/core/call-options";
import { MAX_AI_TASKS, MAX_EFFORT_LEVELS, MAX_MODEL_MODALITIES, MAX_MODEL_PARAMETERS, capped } from "../lib/listCaps";

export const aiTaskValidator = v.union(...AI_TASKS.map((task) => v.literal(task)));
export const searchTaskValidator = v.union(...SEARCH_TASKS.map((task) => v.literal(task)));
export const presetKeyValidator = v.union(...PRESET_KEYS.map((preset) => v.literal(preset)));
export const effortValidator = v.union(...EFFORTS.map((effort) => v.literal(effort)));
/** A model's lists as OpenRouter gives them, capped as the models table stores them. */
export const modelModalitiesValidator = capped(v.optional(v.array(v.string())), MAX_MODEL_MODALITIES);
export const modelParametersValidator = capped(v.optional(v.array(v.string())), MAX_MODEL_PARAMETERS);
export const modelEffortsValidator = capped(v.optional(v.array(effortValidator)), MAX_EFFORT_LEVELS);
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
  reasoningEfforts: modelEffortsValidator,
  defaultEffort: v.optional(effortValidator),
  reasoningMandatory: v.optional(v.boolean()),
  intelligenceIndex: v.optional(v.number()),
});

/** What a task runs on: its model and effort, or null when nothing live is set. */
export const taskPickSummaryValidator = v.object({
  task: aiTaskValidator,
  model: v.union(modelSummaryValidator, v.null()),
  effort: v.union(effortValidator, v.null()),
});
/** One pick per AI task: at most MAX_AI_TASKS. */
export const taskPicksValidator = capped(v.array(taskPickSummaryValidator), MAX_AI_TASKS);
