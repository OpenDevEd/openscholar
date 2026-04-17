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
import { getPaperLimit } from "../bucket/limits";

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

/**
 * Server-side "select everything that matches" reader for the bucket's
 * mass-select affordance. Reads up to (paperLimit + 1) rows — the extra
 * row signals truncation without another query — then slices down to
 * the cap. Client passes the same `query` it uses on `list`, so the
 * set of items staged matches exactly what the paginated view shows.
 */
export const listAllIds = query({
  args: {
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    const limit = await getPaperLimit(ctx, user._id);

    const search = args.query?.trim();
    const rows = search
      ? await ctx.db
          .query("libraryItems")
          .withSearchIndex("search_library", (q) =>
            q.search("searchableText", search).eq("userId", user._id),
          )
          .take(limit + 1)
      : await ctx.db
          .query("libraryItems")
          .withIndex("by_user_savedAt", (q) => q.eq("userId", user._id))
          .order("desc")
          .take(limit + 1);

    const truncated = rows.length > limit;
    return {
      items: truncated ? rows.slice(0, limit) : rows,
      truncated,
    };
  },
});
