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

/**
 * Whether a model can do a task: a decision model (Jev) only screens, and every
 * task but chat asks for a JSON-schema answer, which needs `structured_outputs`
 * (`response_format` alone is plain JSON mode).
 */
export function usableFor(model: Pick<Doc<"models">, "modelId" | "supportedParameters">, task: AiTask) {
  if (isDecisionModel(model.modelId)) return DECISION_TASKS.includes(task);
  return task === "chat" || model.supportedParameters?.includes("structured_outputs") === true;
}

/** Refuses a model for a task it can't do. */
export function requireTaskModel(model: Doc<"models">, task: AiTask) {
  if (usableFor(model, task)) return;
  throw createError(
    "VALIDATION_ERROR",
    isDecisionModel(model.modelId) ? `${model.name} only answers screening questions.` : `${model.name} can't return the structured answers this task needs.`,
  );
}
