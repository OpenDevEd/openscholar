// A person's own Zenodo account (#1237), connected through Zenodo's OAuth sign-in (an app registered on zenodo.org;
// its id and secret are ZENODO_OAUTH_CLIENT_ID and ZENODO_OAUTH_CLIENT_SECRET). Reports they publish may be
// archived there, under their name, instead of in Openscholar's account. The sign-in and the tokens are
// ./connectionActions.ts's, which needs Node for their encryption.
import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import { getCurrentUser, refuseApps } from "../lib/auth";
import { createError } from "../lib/errors";
import { register } from "../reports/registering";

/** How many of a person's reports one reconnection sends to Zenodo again; any more go with the next. */
const RESENT_AT_ONCE = 50;
/** How long a sign-in may take before what Zenodo hands back is refused. */
const STATE_MS = 15 * 60 * 1000;
const accountValidator = v.union(v.null(), v.object({ name: v.union(v.string(), v.null()), zenodoUserId: v.union(v.string(), v.null()), connectedAt: v.number(), broken: v.boolean() }));

/** The person's connected account, null when none is. */
export const mine = query({
  args: {},
  returns: accountValidator,
  handler: async (ctx) => {
    await refuseApps(ctx);
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const row = await ctx.db.query("zenodoConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    return row ? { name: row.name ?? null, zenodoUserId: row.zenodoUserId ?? null, connectedAt: row.connectedAt, broken: row.broken === true } : null;
  },
});

export const keepState = internalMutation({
  args: { state: v.string(), userId: v.id("users"), returnTo: v.string() },
  returns: v.null(),
  handler: async (ctx, { state, userId, returnTo }) => {
    const now = Date.now();
    // Sign-ins nobody finished go as new ones start: a person rarely has more than one under way.
    for (const old of await ctx.db.query("zenodoOAuthStates").withIndex("by_expiry", (q) => q.lt("expiresAt", now)).take(50)) await ctx.db.delete("zenodoOAuthStates", old._id);
    await ctx.db.insert("zenodoOAuthStates", { state, userId, returnTo, expiresAt: now + STATE_MS });
    return null;
  },
});

export const takeState = internalMutation({
  args: { state: v.string(), userId: v.id("users") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { state, userId }) => {
    const row = await ctx.db.query("zenodoOAuthStates").withIndex("by_state", (q) => q.eq("state", state)).unique();
    if (!row) return null;
    await ctx.db.delete("zenodoOAuthStates", row._id);
    return row.userId === userId && row.expiresAt > Date.now() ? row.returnTo : null;
  },
});

export const keep = internalMutation({
  args: { userId: v.id("users"), encryptedTokens: v.string(), expiresAt: v.number(), zenodoUserId: v.optional(v.string()), name: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { userId, ...connection }) => {
    const row = await ctx.db.query("zenodoConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (row) await ctx.db.replace("zenodoConnections", row._id, { userId, ...connection, connectedAt: Date.now() });
    else await ctx.db.insert("zenodoConnections", { userId, ...connection, connectedAt: Date.now() });
    // Reports whose archiving failed for want of the account go to it again now.
    for (const report of await ctx.db.query("reports").withIndex("by_archiveOwnerId_and_archive", (q) => q.eq("archiveOwnerId", userId).eq("archive", "failed")).take(RESENT_AT_ONCE)) {
      if (report.status === "live") await register(ctx, report);
    }
    return null;
  },
});

/** Forgets the person's Zenodo account. Reports already archived there stay there; new ones can't go there. */
export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await refuseApps(ctx);
    const user = await getCurrentUser(ctx);
    if (!user) throw createError("UNAUTHENTICATED", "Sign in first.");
    const row = await ctx.db.query("zenodoConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (row) await ctx.db.delete("zenodoConnections", row._id);
    return null;
  },
});

export const stored = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), v.object({ encryptedTokens: v.string(), expiresAt: v.number(), broken: v.boolean() })),
  handler: async (ctx, { userId }) => {
    const row = await ctx.db.query("zenodoConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    return row ? { encryptedTokens: row.encryptedTokens, expiresAt: row.expiresAt, broken: row.broken === true } : null;
  },
});

export const renewed = internalMutation({
  args: { userId: v.id("users"), encryptedTokens: v.optional(v.string()), expiresAt: v.optional(v.number()), broken: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { userId, ...change }) => {
    const row = await ctx.db.query("zenodoConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (row) await ctx.db.patch("zenodoConnections", row._id, change);
    return null;
  },
});

export const RECONNECT = "The author's Zenodo account isn't connected any more. They connect it again on Settings > Connections, then publishing tries again.";
