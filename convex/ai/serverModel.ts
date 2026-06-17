import { internalQuery } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  resolveServerModelChoice,
  type PresetKey,
} from "../../lib/ai/resolve-server-model";

/**
 * System default preset ("medium"). Used when a user has no stored choice, or
 * when a custom/preset selection can't be resolved to a live `models` row.
 */
export const DEFAULT_SERVER_PRESET: PresetKey = "balanced";

/**
 * Resolve a preset key → the `Id<"models">` it points at, via aiModelConfig
 * (`preset.<key>` → slug) joined to the `models` catalog.
 */
async function presetModelId(
  ctx: QueryCtx | MutationCtx,
  preset: PresetKey,
): Promise<Id<"models"> | null> {
  const cfg = await ctx.db
    .query("aiModelConfig")
    .withIndex("by_key", (q) => q.eq("key", `preset.${preset}`))
    .unique();
  if (!cfg) return null;

  const model = await ctx.db
    .query("models")
    .withIndex("by_model_id", (q) => q.eq("modelId", cfg.modelId))
    .unique();
  return model?._id ?? null;
}

/**
 * Resolve the per-user server model to a concrete `Id<"models">` for stamping
 * on a job (extraction / screening / chat default). Reads the user's
 * `userAiConfig`, applies the sticky-custom decision, and falls back to the
 * default preset when nothing resolves. Returns null only if even the default
 * preset isn't seeded/served (caller should treat that as a config error).
 */
export async function resolveServerModelId(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Id<"models"> | null> {
  const cfg = await ctx.db
    .query("userAiConfig")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  const decision = resolveServerModelChoice(
    cfg ? { serverPreset: cfg.serverPreset, serverModelId: cfg.serverModelId ?? null } : null,
    DEFAULT_SERVER_PRESET,
  );

  if (decision.kind === "custom") {
    // The remembered custom model — verify it still exists, else fall back.
    const row = await ctx.db.get("models", decision.modelId as Id<"models">);
    if (row) return row._id;
    return presetModelId(ctx, DEFAULT_SERVER_PRESET);
  }

  const byPreset = await presetModelId(ctx, decision.preset);
  return byPreset ?? presetModelId(ctx, DEFAULT_SERVER_PRESET);
}

/**
 * Action-callable wrapper around resolveServerModelId (actions have no ctx.db).
 * Returns the resolved `Id<"models">` for a user, or null if even the default
 * preset can't be resolved.
 */
export const resolveForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.id("models"), v.null()),
  handler: async (ctx, { userId }) => resolveServerModelId(ctx, userId),
});
