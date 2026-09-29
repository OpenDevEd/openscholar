import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Effort } from "../../lib/ai/core/call-options";
import { isDecisionModel } from "../../lib/ai/decisions";
import { DECISION_TASKS, type AiTask } from "../../lib/ai/tasks";
import { createError } from "../lib/errors";

// ponytail: one transaction handles up to 2,000 active models. Increase only
// after checking Convex transaction limits; never add a self-scheduling loop.
export const MAX_CATALOG_MODELS = 2_000;

export function activeModels(ctx: QueryCtx, provider?: string) {
  return provider
    ? ctx.db.query("models").withIndex("by_provider_and_retiredAt", q => q.eq("provider", provider).eq("retiredAt", undefined))
    : ctx.db.query("models").withIndex("by_retiredAt", q => q.eq("retiredAt", undefined));
}

/** Models users can pick: everything active that an admin hasn't hidden. */
export const pickable = <T extends { hidden?: boolean }>(rows: T[]) => rows.filter((row) => !row.hidden);

export const MODEL_UNAVAILABLE_MESSAGE = "Selected model is no longer available. Choose another model.";

export async function requireAvailableModel(ctx: QueryCtx, modelId: Id<"models">) {
  const model = await ctx.db.get("models", modelId);
  if (!model || model.retiredAt !== undefined || model.hidden) {
    throw createError("VALIDATION_ERROR", MODEL_UNAVAILABLE_MESSAGE);
  }
  return model;
}

/** Refuses an effort the model doesn't take ("none" included, where reasoning is mandatory). */
export function requireEffort(model: Doc<"models">, effort: Effort | undefined) {
  if (effort && !model.reasoningEfforts?.includes(effort)) {
    throw createError("VALIDATION_ERROR", `${model.name} doesn't take ${effort} reasoning effort.`);
  }
}

/** Refuses a decision model (Jev) for a task that needs text, since it only answers yes/no. */
export function requireTaskModel(model: Doc<"models">, task: AiTask) {
  if (isDecisionModel(model.modelId) && !DECISION_TASKS.includes(task)) {
    throw createError("VALIDATION_ERROR", `${model.name} only answers screening questions.`);
  }
}

/** Models a text task can use: everything but decision models. */
export const textModels = <T extends { modelId: string }>(rows: T[]) => rows.filter((row) => !isDecisionModel(row.modelId));
