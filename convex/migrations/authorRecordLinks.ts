import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Moves each author profile's OpenAlex record across as its first link in `authorRecordLinks`. Run after the deploy that adds
 * the table; running it again changes nothing. A record two profiles hold stays with the first, and the other is counted and
 * logged: its `openalex` stays as it is for someone to look at.
 *
 *   npx convex run migrations/authorRecordLinks:run   # how many it linked, and how many were already another's
 */
export const page = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ linked: v.number(), taken: v.number(), isDone: v.boolean(), cursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const read = await ctx.db.query("authorProfiles").paginate({ numItems: 100, cursor });
    let [linked, taken] = [0, 0];
    for (const profile of read.page) {
      if (!profile.openalex) continue;
      const held = await ctx.db.query("authorRecordLinks").withIndex("by_authorId", (q) => q.eq("authorId", profile.openalex)).first();
      if (held?.profileId === profile._id) continue;
      if (held) {
        console.warn(`[authors] ${profile._id} and ${held.profileId} both name ${profile.openalex}; it stays with the other.`);
        taken++;
        continue;
      }
      await ctx.db.insert("authorRecordLinks", { profileId: profile._id, authorId: profile.openalex });
      linked++;
    }
    return { linked, taken, isDone: read.isDone, cursor: read.continueCursor };
  },
});

export const run = internalAction({
  args: {},
  returns: v.object({ linked: v.number(), taken: v.number() }),
  handler: async (ctx): Promise<{ linked: number; taken: number }> => {
    const total = { linked: 0, taken: 0 };
    let cursor: string | null = null;
    for (;;) {
      const done: { linked: number; taken: number; isDone: boolean; cursor: string } = await ctx.runMutation(internal.migrations.authorRecordLinks.page, { cursor });
      total.linked += done.linked;
      total.taken += done.taken;
      if (done.isDone) return total;
      cursor = done.cursor;
    }
  },
});
