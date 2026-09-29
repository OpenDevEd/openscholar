import { requireAvailableModel } from "../models/catalog";
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { serverPresetValidator } from "../aiModelConfig/validators";
import { requireAuth } from "../lib/auth";
import { recommendedModelId } from "../ai/serverModel";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ServerPreset } from "../../lib/ai/resolve-server-model";

async function writeUserConfig(
  ctx: MutationCtx,
  userId: Id<"users">,
  fields: { serverPreset?: ServerPreset; serverModelId?: Id<"models"> },
) {
  const existing = await ctx.db
    .query("userAiConfig")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  if (existing) {
    await ctx.db.patch("userAiConfig", existing._id, { ...fields, updatedAt: Date.now() });
  } else {
    // New row needs a serverPreset; default to the chosen one or Recommended.
    await ctx.db.insert("userAiConfig", {
      userId,
      serverPreset: fields.serverPreset ?? "recommended",
      serverModelId: fields.serverModelId,
      updatedAt: Date.now(),
    });
  }
}

/** The user's remembered custom model, if it's still offered. */
async function rememberedModel(ctx: MutationCtx, userId: Id<"users">) {
  const cfg = await ctx.db
    .query("userAiConfig")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const row = cfg?.serverModelId ? await ctx.db.get("models", cfg.serverModelId) : null;
  return row && row.retiredAt === undefined && !row.hidden ? row : null;
}

/**
 * Switch the active server preset. serverModelId is left untouched (sticky), so
 * the remembered custom model survives a toggle. Switching to custom with
 * nothing live remembered starts from Recommended's chat model.
 */
export const setPreset = mutation({
  args: { serverPreset: serverPresetValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const remembered = args.serverPreset === "custom" ? await rememberedModel(ctx, user._id) : null;
    const seed = args.serverPreset === "custom" && !remembered ? await recommendedModelId(ctx, "chat") : null;
    await writeUserConfig(ctx, user._id, { serverPreset: args.serverPreset, ...(seed && { serverModelId: seed }) });
    return null;
  },
});

/**
 * Pick a custom server model. Validates the model is served, then sets
 * serverPreset = "custom" and remembers the model id.
 */
export const setCustomModel = mutation({
  args: { serverModelId: v.id("models") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Custom accepts any catalog model (isServed is curation, not a runtime gate).
    await requireAvailableModel(ctx, args.serverModelId);

    await writeUserConfig(ctx, user._id, { serverPreset: "custom", serverModelId: args.serverModelId });
    return null;
  },
});
