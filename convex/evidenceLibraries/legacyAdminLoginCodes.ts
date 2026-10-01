import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";

const BATCH_SIZE = 200;

/**
 * Deletes the old one-time admin sign-in codes, a batch at a time, until the
 * table is empty. Run once per deployment:
 * `npx convex run evidenceLibraries/legacyAdminLoginCodes:purge`. The table is
 * dropped from the schema after every deployment has run it.
 */
export const purge = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("evidenceLibraryAdminLoginCodes").take(BATCH_SIZE);
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    const done = rows.length < BATCH_SIZE;
    if (!done) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.legacyAdminLoginCodes.purge, {});
    return { deleted: rows.length, done };
  },
});
