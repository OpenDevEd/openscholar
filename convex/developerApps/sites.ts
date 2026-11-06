// The sites a person signed in to through a developer app, as the connections page lists them.
// A site is recorded the first time it changes something for them (getIdentity in convex/lib/auth.ts);
// one that only reads is never listed.

import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { mutation, query } from "../lib/functions";
import { refuseApps, requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";

/** Most sites one page holds, and the rows one read of it may pass over for apps being deleted. */
const SITES_PAGE_MAX = 50;
const SITES_ROWS_READ = 500;

const siteValidator = v.object({
  _id: v.id("developerAppGrants"),
  name: v.string(),
  website: v.string(),
  lastUsedAt: v.number(),
  disconnectedAt: v.optional(v.number()),
});

/** The person's sites, newest allowed first, so disconnecting or allowing one again keeps its place. */
export const listSites = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(siteValidator),
  handler: async (ctx, { paginationOpts }) => {
    await refuseApps(ctx);
    const user = await requireAuth(ctx);
    return await stream(ctx.db, schema)
      .query("developerAppGrants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .map(async (grant) => ({ grant, app: await ctx.db.get("developerApps", grant.appId) }))
      // A deleted app's rows go in the background; until then they aren't shown.
      .filterWith(async ({ app }) => app !== null)
      .map(async ({ grant, app }) => ({
        _id: grant._id,
        name: app!.name,
        website: app!.website,
        lastUsedAt: grant.lastUsedAt,
        ...(grant.disconnectedAt ? { disconnectedAt: grant.disconnectedAt } : {}),
      }))
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, SITES_PAGE_MAX), maximumRowsRead: SITES_ROWS_READ });
  },
});

/** Disconnects a site, which refuses its tokens for the person until they allow it again, or allows it again. */
export const setDisconnected = mutation({
  args: { siteId: v.id("developerAppGrants"), disconnected: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { siteId, disconnected }) => {
    await refuseApps(ctx);
    const user = await requireAuth(ctx);
    const grant = await ctx.db.get("developerAppGrants", siteId);
    if (!grant || grant.userId !== user._id) throw createError("NOT_FOUND", "This site isn't on your list.");
    await ctx.db.patch("developerAppGrants", siteId, { disconnectedAt: disconnected ? Date.now() : undefined });
    return null;
  },
});
