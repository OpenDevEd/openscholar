import { v } from "convex/values";
import { query } from "../_generated/server";
import schema from "../schema";

/**
 * Returns all feature flags as raw documents.
 * Client-side hooks resolve these against the user's tier.
 * Table is small (~10-30 rows), .collect() is safe.
 */
export const getAll = query({
  args: {},
  returns: v.array(schema.doc("featureFlags")),
  handler: async (ctx) => {
    return await ctx.db.query("featureFlags").collect();
  },
});
