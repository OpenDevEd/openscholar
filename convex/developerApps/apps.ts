// Apps people build on Openscholar: each is an OAuth application in Clerk that signs people in
// and calls Convex as them (convex/lib/auth.ts, getIdentity). Its owner manages it on the
// connections page; Clerk's own calls run in ./actions.ts.

import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internalMutation, internalQuery, query } from "../lib/functions";
import { internal } from "../_generated/api";
import { refuseApps, requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { libraryOAuthApplicationName } from "../evidenceLibraries/oauthClients";
import { MAX_APP_REDIRECT_URIS } from "../lib/listCaps";
import { appKindValidator, redirectUrisValidator } from "./validators";

/** Most apps one person makes. */
export const MAX_APPS = 10;
const MAX_NAME = 80;
/** Grants one cleanup batch deletes after an app is deleted. */
const GRANT_BATCH = 200;

const appValidator = v.object({
  _id: v.id("developerApps"),
  _creationTime: v.number(),
  name: v.string(),
  website: v.string(),
  redirectUris: redirectUrisValidator,
  kind: appKindValidator,
  clientId: v.string(),
});
export const detailsValidator = { name: v.string(), website: v.string(), redirectUris: v.array(v.string()) };

/** https, or http on this computer while an app is being built. */
function webAddress(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

/** An app's name, website and redirect addresses, trimmed, or the reason they can't be saved. */
export function cleanDetails(input: { name: string; website: string; redirectUris: string[] }) {
  const name = input.name.trim();
  const website = input.website.trim();
  const redirectUris = [...new Set(input.redirectUris.map((uri) => uri.trim()).filter(Boolean))];
  if (!name || name.length > MAX_NAME) throw createError("VALIDATION_ERROR", `Give the app a name of up to ${MAX_NAME} characters.`);
  // Clerk doesn't keep names unique, and a community's sign-in adopts its application by name.
  if (name.startsWith(libraryOAuthApplicationName(""))) throw createError("VALIDATION_ERROR", "Choose another name for the app.");
  if (!webAddress(website)) throw createError("VALIDATION_ERROR", "The website needs an https address.");
  if (redirectUris.length === 0 || redirectUris.length > MAX_APP_REDIRECT_URIS) {
    throw createError("VALIDATION_ERROR", `Give 1 to ${MAX_APP_REDIRECT_URIS} redirect URLs.`);
  }
  if (!redirectUris.every(webAddress)) throw createError("VALIDATION_ERROR", "Redirect URLs need https addresses.");
  return { name, website, redirectUris };
}

export const listApps = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(appValidator),
  handler: async (ctx, { paginationOpts }) => {
    await refuseApps(ctx);
    const user = await requireAuth(ctx);
    const page = await ctx.db
      .query("developerApps")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, MAX_APPS) });
    return {
      ...page,
      page: page.page.map(({ _id, _creationTime, name, website, redirectUris, kind, clientId }) => ({ _id, _creationTime, name, website, redirectUris, kind, clientId })),
    };
  },
});

export const countApps = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await refuseApps(ctx);
    const user = await requireAuth(ctx);
    return (await ctx.db.query("developerApps").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).take(MAX_APPS)).length;
  },
});

/** The signed-in person, how many apps they have, and the app `appId` if it's theirs: what an action checks before it calls Clerk. */
export const owner = internalQuery({
  args: { appId: v.optional(v.id("developerApps")) },
  returns: v.object({
    userId: v.id("users"),
    count: v.number(),
    app: v.union(v.null(), v.object({ clerkApplicationId: v.string(), kind: appKindValidator })),
  }),
  handler: async (ctx, { appId }) => {
    const user = await requireAuth(ctx);
    const count = (await ctx.db.query("developerApps").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).take(MAX_APPS)).length;
    const app = appId ? await ctx.db.get("developerApps", appId) : null;
    if (appId && app?.ownerId !== user._id) throw createError("NOT_FOUND", "This app isn't yours, or it was deleted.");
    return { userId: user._id, count, app: app ? { clerkApplicationId: app.clerkApplicationId, kind: app.kind } : null };
  },
});

/** Saves an app Clerk just made. False when the person reached the limit meanwhile, so the action deletes it from Clerk. */
export const insert = internalMutation({
  args: { ownerId: v.id("users"), ...detailsValidator, kind: appKindValidator, clientId: v.string(), clerkApplicationId: v.string() },
  returns: v.union(v.null(), v.id("developerApps")),
  handler: async (ctx, args) => {
    const count = (await ctx.db.query("developerApps").withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId)).take(MAX_APPS)).length;
    if (count >= MAX_APPS) return null;
    return await ctx.db.insert("developerApps", args);
  },
});

export const update = internalMutation({
  args: { appId: v.id("developerApps"), ...detailsValidator },
  returns: v.null(),
  handler: async (ctx, { appId, ...details }) => {
    await ctx.db.patch("developerApps", appId, details);
    return null;
  },
});

/** Deletes an app, which stops its tokens at once (getIdentity finds no app), and the sites list's rows for it after. */
export const remove = internalMutation({
  args: { appId: v.id("developerApps") },
  returns: v.null(),
  handler: async (ctx, { appId }) => {
    await ctx.db.delete("developerApps", appId);
    await ctx.scheduler.runAfter(0, internal.developerApps.apps.removeGrants, { appId });
    return null;
  },
});

export const removeGrants = internalMutation({
  args: { appId: v.id("developerApps") },
  returns: v.null(),
  handler: async (ctx, { appId }) => {
    const grants = await ctx.db.query("developerAppGrants").withIndex("by_app", (q) => q.eq("appId", appId)).take(GRANT_BATCH);
    await Promise.all(grants.map((grant) => ctx.db.delete("developerAppGrants", grant._id)));
    if (grants.length === GRANT_BATCH) await ctx.scheduler.runAfter(0, internal.developerApps.apps.removeGrants, { appId });
    return null;
  },
});

/** What `requireActionAuth` runs for an action a developer app calls: its builder checks and records the call (`recordAppUse`). */
export const checkCall = internalMutation({
  args: {},
  returns: v.null(),
  handler: async () => null,
});
