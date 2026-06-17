import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const serverPresetValidator = v.union(
  v.literal("fast"),
  v.literal("balanced"),
  v.literal("intelligent"),
  v.literal("custom"),
);

async function writeUserConfig(
  ctx: MutationCtx,
  userId: Id<"users">,
  fields: { serverPreset?: "fast" | "balanced" | "intelligent" | "custom"; serverModelId?: Id<"models"> },
) {
  const existing = await ctx.db
    .query("userAiConfig")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  if (existing) {
    await ctx.db.patch("userAiConfig", existing._id, { ...fields, updatedAt: Date.now() });
  } else {
    // New row needs a serverPreset; default to the chosen one or "balanced".
    await ctx.db.insert("userAiConfig", {
      userId,
      serverPreset: fields.serverPreset ?? "balanced",
      serverModelId: fields.serverModelId,
      updatedAt: Date.now(),
    });
  }
}

/**
 * Switch the active server preset. Writes ONLY serverPreset — serverModelId is
 * left untouched (sticky), so the remembered custom model survives a toggle.
 */
export const setPreset = mutation({
  args: { serverPreset: serverPresetValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await writeUserConfig(ctx, user._id, { serverPreset: args.serverPreset });
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
    const model = await ctx.db.get("models", args.serverModelId);
    if (!model) {
      throw createError("VALIDATION_ERROR", "Selected model was not found");
    }

    await writeUserConfig(ctx, user._id, { serverPreset: "custom", serverModelId: args.serverModelId });
    return null;
  },
});
