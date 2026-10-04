import { MAX_FEATURE_FLAGS } from "../lib/queryBounds";
import { paginationResultValidator } from "convex/server";
import { query } from "../_generated/server";
import schema from "../schema";

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
