import { MAX_FEATURE_FLAGS } from "../lib/queryBounds";
import { v } from "convex/values";
import { query } from "../_generated/server";
import schema from "../schema";

/**
 * Returns all feature flags as raw documents.
 * Client-side hooks resolve these against the user's tier.
 * The table holds at most MAX_FEATURE_FLAGS (./internal.ts refuses more).
 */
export const getAll = query({
  args: {},
  returns: v.array(schema.doc("featureFlags")),
  handler: async (ctx) => {
    return await ctx.db.query("featureFlags").take(MAX_FEATURE_FLAGS);
  },
});
