/**
 * Paginated library-item reader scoped to the bucket UX. The existing
 * convex/library/queries.ts covers the main library browse page with
 * a rich filter matrix (rating, year, collection, sort order); the
 * extraction bucket only needs a simple "find items I've saved" lookup
 * with optional fulltext search, so we live here and stay small rather
 * than re-export the heavier browse.
 */
import { query } from "../../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);

    const search = args.query?.trim();
    if (search) {
      return await ctx.db
        .query("libraryItems")
        .withSearchIndex("search_library", (q) =>
          q.search("searchableText", search).eq("userId", user._id),
        )
        .paginate(args.paginationOpts);
    }
    return await ctx.db
      .query("libraryItems")
      .withIndex("by_user_savedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
