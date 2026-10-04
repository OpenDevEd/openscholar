import { MAX_FEATURE_FLAGS } from "../lib/queryBounds";
import { v } from "convex/values";
import { paginationResultValidator } from "convex/server";
import { query } from "../_generated/server";
import schema from "../schema";

/**
 * Returns all feature flags as raw documents.
 * Kept for one release, while the deployed site still calls it; `list` replaces it.
 */
export const getAll = query({
  args: {},
  returns: v.array(schema.doc("featureFlags")),
  handler: async (ctx) => {
    return await ctx.db.query("featureFlags").take(MAX_FEATURE_FLAGS);
  },
});

/**
 * Every feature flag as its raw document, as one page.
 * Client-side hooks resolve these against the user's plan.
 * The table holds at most MAX_FEATURE_FLAGS (./internal.ts refuses more), so the page is always the last.
 */
export const list = query({
  args: {},
  returns: paginationResultValidator(schema.doc("featureFlags")),
  handler: async (ctx) => ({ page: await ctx.db.query("featureFlags").take(MAX_FEATURE_FLAGS), isDone: true, continueCursor: "" }),
});
