// Calls a developer app makes for a person (convex/developerApps): the checks every read of the
// identity runs (getIdentity in ./auth.ts), and the record every mutation keeps (./functions.ts).
// Kept apart from ./auth.ts, which ./functions.ts can't import without a cycle.

import type { UserIdentity } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "./errors";

/** What reading the identity needs: a query's or a mutation's auth and database. */
export type IdentityCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

/** The OAuth client a token was issued to: set when a developer app makes the call for a person. */
export function appClientId(identity: UserIdentity | null) {
  return identity && typeof identity.client_id === "string" ? identity.client_id : null;
}

/** How stale a site's "last used" may get before a mutation writes it again. */
const APP_USE_STEP = 60 * 60 * 1000;

/**
 * The developer app a token was issued to, the person it acts for, and their row for the app on
 * their list of sites. Refuses a token of an app that was deleted, or that the person disconnected.
 */
export async function appCall(ctx: IdentityCtx, identity: UserIdentity, clientId: string) {
  const app = await ctx.db.query("developerApps").withIndex("by_client_id", (q) => q.eq("clientId", clientId)).unique();
  if (!app) throw createError("UNAUTHENTICATED", "This app was deleted on Openscholar.");
  const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject)).unique();
  if (!user) return null;
  const grant = await ctx.db
    .query("developerAppGrants")
    .withIndex("by_user_and_app", (q) => q.eq("userId", user._id).eq("appId", app._id))
    .unique();
  if (grant?.disconnectedAt) {
    throw createError("FORBIDDEN", "You disconnected this site from your Openscholar account. Allow it again in Settings, under Connections.");
  }
  return { app, user, grant };
}

/**
 * Checks a developer app's call and puts the app on the person's list of sites, or moves on when it
 * was last used. Every mutation runs it before its handler (./functions.ts), so a site that changes
 * anything is listed, and a query, which can't write, never reads the clock for it.
 */
export async function recordAppUse(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  const clientId = appClientId(identity);
  if (!identity || !clientId) return;
  const call = await appCall(ctx, identity, clientId);
  if (!call) return;
  const now = Date.now();
  if (!call.grant) await ctx.db.insert("developerAppGrants", { userId: call.user._id, appId: call.app._id, lastUsedAt: now });
  else if (now - call.grant.lastUsedAt > APP_USE_STEP) await ctx.db.patch("developerAppGrants", call.grant._id, { lastUsedAt: now });
}

