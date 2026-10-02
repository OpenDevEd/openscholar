import { v } from "convex/values";
import { internalMutation } from "../lib/functions";

/**
 * Deletes the one-row served hosts cache (`evidenceLibraryServedHosts`), which the
 * per-host listing replaced (#426). Run once per deployment after it deploys, then drop
 * the table:
 *   npx convex run migrations/dropServedHostsList:run
 * It's a cache: the next address check lists Coolify again.
 */
export const run = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    // One row per source, and there is one source.
    const rows = await ctx.db.query("evidenceLibraryServedHosts").take(10);
    for (const row of rows) await ctx.db.delete("evidenceLibraryServedHosts", row._id);
    return { deleted: rows.length };
  },
});
