import { internalQuery } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { AI_TASKS, DEFAULT_PRESET, presetConfigKey, type AiTask, type PresetKey } from "../../lib/ai/tasks";
import type { Effort } from "../../lib/ai/core/call-options";
import { aiTaskValidator, taskPickValidator } from "../aiModelConfig/validators";

/** A model a task runs on, and its reasoning effort (none: the model's default). */
export type TaskPick = { modelId: Id<"models">; effort?: Effort };

const offered = (model: Doc<"models"> | null): model is Doc<"models"> =>
  model !== null && model.retiredAt === undefined && !model.hidden;

/** The effort, if the model still takes it; otherwise the model's own default. */
function withEffort(model: Doc<"models">, effort: Effort | undefined): TaskPick {
  return effort && model.reasoningEfforts?.includes(effort) ? { modelId: model._id, effort } : { modelId: model._id };
}

/** A preset's pick for a task, if it points at a model users can pick. */
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
  return offered(model) ? withEffort(model, cfg.effort) : null;
}

/** A stored pick, if its model is still offered. */
export async function livePick(ctx: QueryCtx | MutationCtx, pick: TaskPick | undefined): Promise<TaskPick | null> {
  const model = pick ? await ctx.db.get("models", pick.modelId) : null;
  return offered(model) ? withEffort(model, pick?.effort) : null;
}

export async function userAiConfig(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("userAiConfig")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * The new fields for a row saved before presets: Recommended becomes the
 * default preset, One model becomes Custom with that model on every task.
 * Also clears the old fields. Used by the migration and before any write.
 */
export function fromLegacy(cfg: Doc<"userAiConfig">) {
  const legacy =
    cfg.choice !== undefined ? {}
    : cfg.serverPreset === "custom" && cfg.serverModelId
      ? { choice: "custom" as const, custom: Object.fromEntries(AI_TASKS.map((task) => [task, { modelId: cfg.serverModelId! }])) }
      : { choice: cfg.serverPreset === "fast" || cfg.serverPreset === "intelligent" ? cfg.serverPreset : DEFAULT_PRESET };
  return { ...legacy, serverPreset: undefined, serverModelId: undefined } as Partial<Doc<"userAiConfig">>;
}

/** A row as it reads after migration, so a row saved before presets resolves the same before it's migrated. */
export function withLegacy(cfg: Doc<"userAiConfig"> | null) {
  return cfg && cfg.choice === undefined ? { ...cfg, ...fromLegacy(cfg) } : cfg;
}

/** The user's row, converted first if it was saved before presets. */
export async function currentUserAiConfig(ctx: MutationCtx, userId: Id<"users">) {
  const cfg = await userAiConfig(ctx, userId);
  if (!cfg || (cfg.serverPreset === undefined && cfg.serverModelId === undefined)) return cfg;
  await ctx.db.patch("userAiConfig", cfg._id, fromLegacy(cfg));
  return await ctx.db.get("userAiConfig", cfg._id);
}

/**
 * What a user's `task` runs on: their Custom pick, else their preset's, else
 * the default preset's. Null only when nothing is configured at all.
 */
export async function resolveTaskPick(ctx: QueryCtx | MutationCtx, userId: Id<"users">, task: AiTask): Promise<TaskPick | null> {
  const cfg = withLegacy(await userAiConfig(ctx, userId));
  const choice = cfg?.choice ?? DEFAULT_PRESET;
  const picked = choice === "custom" ? await livePick(ctx, cfg?.custom?.[task]) : await presetPick(ctx, choice, task);
  return picked ?? (choice === DEFAULT_PRESET ? null : await presetPick(ctx, DEFAULT_PRESET, task));
}

/** Job fields that record what a background run uses. */
export const serverStamp = (pick: TaskPick | null) =>
  pick ? { serverModelId: pick.modelId, ...(pick.effort && { serverEffort: pick.effort }) } : {};

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
