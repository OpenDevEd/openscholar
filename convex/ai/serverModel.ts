import { internalQuery } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { resolveServerModelChoice, type PresetKey } from "../../lib/ai/resolve-server-model";
import { taskConfigKey, type AiTask } from "../../lib/ai/tasks";
import { aiTaskValidator } from "../aiModelConfig/validators";

/** The model used when nothing else resolves. */
export const DEFAULT_SERVER_PRESET: PresetKey = "balanced";

/** An `aiModelConfig` key (`preset.<key>` or `task.<task>`) → the live model it points at. */
export async function configModelId(ctx: QueryCtx | MutationCtx, key: string): Promise<Id<"models"> | null> {
  const cfg = await ctx.db
    .query("aiModelConfig")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!cfg) return null;
  const model = await ctx.db
    .query("models")
    .withIndex("by_model_id", (q) => q.eq("modelId", cfg.modelId))
    .unique();
  return model && model.retiredAt === undefined && !model.hidden ? model._id : null;
}

/** The model Recommended runs a task on: the admin's pick for it, else the default preset. */
export async function recommendedModelId(ctx: QueryCtx | MutationCtx, task: AiTask): Promise<Id<"models"> | null> {
  return (await configModelId(ctx, taskConfigKey(task))) ?? (await configModelId(ctx, `preset.${DEFAULT_SERVER_PRESET}`));
}

/**
 * The one model every task runs on when the user picked one (custom or a
 * preset), or null on Recommended, or when that model is no longer offered.
 */
export async function oneModelId(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<Id<"models"> | null> {
  const cfg = await ctx.db
    .query("userAiConfig")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const decision = resolveServerModelChoice(
    cfg ? { serverPreset: cfg.serverPreset, serverModelId: cfg.serverModelId ?? null } : null,
  );
  if (decision.kind === "custom") {
    const row = await ctx.db.get("models", decision.modelId as Id<"models">);
    return row && row.retiredAt === undefined && !row.hidden ? row._id : null;
  }
  return decision.kind === "preset" ? await configModelId(ctx, `preset.${decision.preset}`) : null;
}

/**
 * The model a user's `task` runs on, for stamping on a job or running an AI
 * action on credits. Returns null only if nothing is configured at all.
 */
export async function resolveServerModelId(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  task: AiTask,
): Promise<Id<"models"> | null> {
  return (await oneModelId(ctx, userId)) ?? (await recommendedModelId(ctx, task));
}

/** Action-callable wrapper around resolveServerModelId (actions have no ctx.db). */
export const resolveForUser = internalQuery({
  args: { userId: v.id("users"), task: aiTaskValidator },
  returns: v.union(v.id("models"), v.null()),
  handler: async (ctx, { userId, task }) => resolveServerModelId(ctx, userId, task),
});

/** The fields the settings map shows for a model, or null when there's none. */
export async function modelSummary(ctx: QueryCtx, id: Id<"models"> | null) {
  const model = id ? await ctx.db.get("models", id) : null;
  if (!model) return null;
  const { _id, modelId, name, inputPricePerMillion, outputPricePerMillion } = model;
  return { _id, modelId, name, inputPricePerMillion, outputPricePerMillion };
}
