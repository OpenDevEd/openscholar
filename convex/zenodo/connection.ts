// A person's own Zenodo account (#1237), connected through Zenodo's OAuth sign-in (an app registered on zenodo.org;
// its id and secret are ZENODO_OAUTH_CLIENT_ID and ZENODO_OAUTH_CLIENT_SECRET). Reports they publish may be
// archived there, under their name, instead of in Openscholar's account. The sign-in and the tokens are
// ./connectionActions.ts's, which needs Node for their encryption.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalQuery, query } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import { getCurrentUser, refuseApps } from "../lib/auth";
import { createError } from "../lib/errors";
import { registerAgain } from "../reports/registration";

/** How many of a person's reports one go of a reconnection sends to Zenodo again; the next go takes the rest. */
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

/** Who started the sign-in this state was given to, and where they go back to; null when it is unknown or expired. */
export const takeState = internalMutation({
  args: { state: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), returnTo: v.string() })),
  handler: async (ctx, { state }) => {
    const row = await ctx.db.query("zenodoOAuthStates").withIndex("by_state", (q) => q.eq("state", state)).unique();
    if (!row) return null;
    await ctx.db.delete("zenodoOAuthStates", row._id);
    return row.expiresAt > Date.now() ? { userId: row.userId, returnTo: row.returnTo } : null;
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
    await ctx.scheduler.runAfter(0, internal.zenodo.connection.resend, { userId, cursor: null });
    return null;
  },
});

/**
 * Sends a person's reports whose archiving failed to their account again, withdrawn ones too (Zenodo still shows
 * those, and is told so): only Zenodo's part, what Crossref already holds stays as it is.
 */
export const resend = internalMutation({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { userId, cursor }) => {
    const page = await ctx.db
      .query("reports")
      .withIndex("by_archiveOwnerId_and_archive", (q) => q.eq("archiveOwnerId", userId).eq("archive", "failed"))
      .paginate({ numItems: RESENT_AT_ONCE, cursor });
    for (const report of page.page) if (report.activatedAt !== undefined) await registerAgain(ctx, report);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.zenodo.connection.resend, { userId, cursor: page.continueCursor });
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

/** The person's tokens, as stored; none for an account that was deleted. */
export const stored = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), v.object({ encryptedTokens: v.string(), expiresAt: v.number(), broken: v.boolean() })),
  handler: async (ctx, { userId }) => {
    const owner = await ctx.db.get("users", userId);
    if (!owner || owner.state === "deleted") return null;
    const row = await ctx.db.query("zenodoConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    return row ? { encryptedTokens: row.encryptedTokens, expiresAt: row.expiresAt, broken: row.broken === true } : null;
  },
});

/**
 * Saves what renewing the tokens read as `from` came to, unless they changed since (another renewal, or a new
 * sign-in): answers whether it was saved, and the renewal that lost takes the tokens stored instead.
 */
export const renewed = internalMutation({
  args: { userId: v.id("users"), from: v.string(), encryptedTokens: v.optional(v.string()), expiresAt: v.optional(v.number()), broken: v.optional(v.boolean()) },
  returns: v.boolean(),
  handler: async (ctx, { userId, from, ...change }) => {
    const row = await ctx.db.query("zenodoConnections").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!row || row.encryptedTokens !== from) return false;
    await ctx.db.patch("zenodoConnections", row._id, change);
    return true;
  },
});

export const RECONNECT = "The author's Zenodo account isn't connected any more. They connect it again on Settings > Connections, then publishing tries again.";
