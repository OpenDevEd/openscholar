import { internalQuery } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { DEFAULT_PRESET, presetConfigKey, usableFor, type AiTask, type PresetKey } from "../../lib/ai/tasks";
import type { Effort } from "../../lib/ai/core/call-options";
import { isDecisionModel } from "../../lib/ai/decisions";
import { aiTaskValidator, taskPickValidator } from "../aiModelConfig/validators";
import type { ExtractionPricing, Pricing } from "../../lib/pricing";
import { SERVER_MODEL_SLUG } from "./config";

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
  return cfg ? await slugPick(ctx, cfg.modelId, cfg.effort, task) : null;
}

/** The model a catalog slug names and the effort it runs at, if users can pick it for the task. */
export async function slugPick(ctx: QueryCtx | MutationCtx, modelId: string, effort: Effort | undefined, task: AiTask): Promise<TaskPick | null> {
  const model = await ctx.db
    .query("models")
    .withIndex("by_model_id", (q) => q.eq("modelId", modelId))
    .unique();
  return offered(model, task) ? withEffort(model, effort) : null;
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
 * What a person's own `task` runs on: their Custom pick, else their preset's, else
 * the default preset's. Null only when nothing is configured at all.
 */
export async function ownTaskPick(ctx: QueryCtx | MutationCtx, userId: Id<"users">, task: AiTask): Promise<TaskPick | null> {
  const cfg = await userAiConfig(ctx, userId);
  const choice = cfg?.choice ?? DEFAULT_PRESET;
  const picked = choice === "custom" ? await livePick(ctx, cfg?.custom?.[task], task) : await presetPick(ctx, choice, task);
  return picked ?? (choice === DEFAULT_PRESET ? null : await presetPick(ctx, DEFAULT_PRESET, task));
}

/** The preset an organization's work runs on, which its admins pick (#651); null in a person's own workspace, which runs on their own settings. */
export async function organizationPreset(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">): Promise<PresetKey | null> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace?.kind !== "organization") return null;
  return (await ctx.db.get("organizations", workspace.organizationId))?.aiPreset ?? DEFAULT_PRESET;
}

/** What `task` runs on for someone working in a workspace: an organization's preset there, else their own settings. */
export async function resolveTaskPick(ctx: QueryCtx | MutationCtx, { userId, workspaceId }: { userId: Id<"users">; workspaceId: Id<"workspaces"> }, task: AiTask): Promise<TaskPick | null> {
  const preset = await organizationPreset(ctx, workspaceId);
  if (preset === null) return await ownTaskPick(ctx, userId, task);
  return (await presetPick(ctx, preset, task)) ?? (preset === DEFAULT_PRESET ? null : await presetPick(ctx, DEFAULT_PRESET, task));
}

/** Job fields that record what a background run uses. */
export const serverStamp = (pick: TaskPick | null) =>
  pick ? { serverModelId: pick.modelId, ...(pick.effort && { serverEffort: pick.effort }) } : {};

/**
 * Job fields for an extraction run: what its questions run on, and the decision
 * model (Jev) its yes/no questions go to when the user screens with one.
 */
export async function extractionStamp(ctx: QueryCtx | MutationCtx, working: { userId: Id<"users">; workspaceId: Id<"workspaces"> }) {
  const screen = await resolveTaskPick(ctx, working, "screenAll");
  const screenModel = screen ? await ctx.db.get("models", screen.modelId) : null;
  return {
    ...serverStamp(await resolveTaskPick(ctx, working, "extraction")),
    ...(screenModel && isDecisionModel(screenModel.modelId) && { decisionModelId: screenModel._id }),
  };
}

/** Action-callable wrapper around resolveTaskPick (actions have no ctx.db). */
export const resolveForUser = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), task: aiTaskValidator },
  returns: v.union(taskPickValidator, v.null()),
  handler: async (ctx, { userId, workspaceId, task }) => resolveTaskPick(ctx, { userId, workspaceId }, task),
});

/** The fields the settings map shows for a model, or null when there's none. */
export async function modelSummary(ctx: QueryCtx, id: Id<"models"> | null) {
  const model = id ? await ctx.db.get("models", id) : null;
  if (!model) return null;
  const { _id, modelId, name, inputPricePerMillion, outputPricePerMillion, longPrompt, contextLength, reasoningEfforts, defaultEffort, reasoningMandatory, intelligenceIndex, inputModalities } = model;
  return { _id, modelId, name, inputPricePerMillion, outputPricePerMillion, longPrompt, contextLength, reasoningEfforts, defaultEffort, reasoningMandatory, intelligenceIndex, inputModalities };
}

/**
 * A model's price for an estimate, or the server model's when there's none: what
 * `resolveOpenRouterModel` runs. Output is priced at the model's reasoning rate where that's
 * higher, since the output an estimate holds may all be reasoning.
 */
export async function pricingOf(ctx: QueryCtx | MutationCtx, id: Id<"models"> | null | undefined): Promise<Pricing> {
  const model = id ? await ctx.db.get("models", id) : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique();
  return model ? { input: model.inputPricePerMillion, output: Math.max(model.outputPricePerMillion, model.reasoningPricePerMillion ?? 0) } : { input: 0, output: 0 };
}

/** The price of what `task` runs on for someone working in a workspace. */
export async function taskPricing(ctx: QueryCtx | MutationCtx, working: { userId: Id<"users">; workspaceId: Id<"workspaces"> }, task: AiTask): Promise<Pricing> {
  return await pricingOf(ctx, (await resolveTaskPick(ctx, working, task))?.modelId);
}

/** The prices of the models an extraction sends its questions to (`extractionStamp`, or a job stamped with it). */
export async function extractionPricing(ctx: QueryCtx | MutationCtx, stamp: { serverModelId?: Id<"models">; decisionModelId?: Id<"models"> }): Promise<ExtractionPricing> {
  return { model: await pricingOf(ctx, stamp.serverModelId), ...(stamp.decisionModelId && { decision: await pricingOf(ctx, stamp.decisionModelId) }) };
}
