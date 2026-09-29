import { internalQuery } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { DEFAULT_PRESET, presetConfigKey, type AiTask, type PresetKey } from "../../lib/ai/tasks";
import type { Effort } from "../../lib/ai/core/call-options";
import { isDecisionModel } from "../../lib/ai/decisions";
import { usableFor } from "../models/catalog";
import { aiTaskValidator, taskPickValidator } from "../aiModelConfig/validators";

/** A model a task runs on, and its reasoning effort (none: the model's default). */
export type TaskPick = { modelId: Id<"models">; effort?: Effort };

/** A model users can pick that can do the task. */
const offered = (model: Doc<"models"> | null, task: AiTask): model is Doc<"models"> =>
  model !== null && model.retiredAt === undefined && !model.hidden && usableFor(model, task);

/** The effort, if the model still takes it; otherwise the model's own default. */
function withEffort(model: Doc<"models">, effort: Effort | undefined): TaskPick {
  return effort && model.reasoningEfforts?.includes(effort) ? { modelId: model._id, effort } : { modelId: model._id };
}

/** A preset's pick for a task, if it points at a model users can pick for it. */
export async function presetPick(ctx: QueryCtx | MutationCtx, preset: PresetKey, task: AiTask): Promise<TaskPick | null> {
  const cfg = await ctx.db
    .query("aiModelConfig")
    .withIndex("by_key", (q) => q.eq("key", presetConfigKey(preset, task)))
    .unique();
  if (!cfg) return null;
  const model = await ctx.db
    .query("models")
    .withIndex("by_model_id", (q) => q.eq("modelId", cfg.modelId))
    .unique();
  return offered(model, task) ? withEffort(model, cfg.effort) : null;
}

/** A stored pick, if its model is still offered for the task. */
export async function livePick(ctx: QueryCtx | MutationCtx, pick: TaskPick | undefined, task: AiTask): Promise<TaskPick | null> {
  const model = pick ? await ctx.db.get("models", pick.modelId) : null;
  return offered(model, task) ? withEffort(model, pick?.effort) : null;
}

export async function userAiConfig(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("userAiConfig")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * What a user's `task` runs on: their Custom pick, else their preset's, else
 * the default preset's. Null only when nothing is configured at all.
 */
export async function resolveTaskPick(ctx: QueryCtx | MutationCtx, userId: Id<"users">, task: AiTask): Promise<TaskPick | null> {
  const cfg = await userAiConfig(ctx, userId);
  const choice = cfg?.choice ?? DEFAULT_PRESET;
  const picked = choice === "custom" ? await livePick(ctx, cfg?.custom?.[task], task) : await presetPick(ctx, choice, task);
  return picked ?? (choice === DEFAULT_PRESET ? null : await presetPick(ctx, DEFAULT_PRESET, task));
}

/** Job fields that record what a background run uses. */
export const serverStamp = (pick: TaskPick | null) =>
  pick ? { serverModelId: pick.modelId, ...(pick.effort && { serverEffort: pick.effort }) } : {};

/**
 * Job fields for an extraction run: what its questions run on, and the decision
 * model (Jev) its yes/no questions go to when the user screens with one.
 */
export async function extractionStamp(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const screen = await resolveTaskPick(ctx, userId, "screenAll");
  const screenModel = screen ? await ctx.db.get("models", screen.modelId) : null;
  return {
    ...serverStamp(await resolveTaskPick(ctx, userId, "extraction")),
    ...(screenModel && isDecisionModel(screenModel.modelId) && { decisionModelId: screenModel._id }),
  };
}

/** Action-callable wrapper around resolveTaskPick (actions have no ctx.db). */
export const resolveForUser = internalQuery({
  args: { userId: v.id("users"), task: aiTaskValidator },
  returns: v.union(taskPickValidator, v.null()),
  handler: async (ctx, { userId, task }) => resolveTaskPick(ctx, userId, task),
});

/** The fields the settings map shows for a model, or null when there's none. */
export async function modelSummary(ctx: QueryCtx, id: Id<"models"> | null) {
  const model = id ? await ctx.db.get("models", id) : null;
  if (!model) return null;
  const { _id, modelId, name, inputPricePerMillion, outputPricePerMillion, reasoningEfforts, defaultEffort, reasoningMandatory } = model;
  return { _id, modelId, name, inputPricePerMillion, outputPricePerMillion, reasoningEfforts, defaultEffort, reasoningMandatory };
}
