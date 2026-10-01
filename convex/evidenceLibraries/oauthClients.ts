import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { readAttachedDomainOrigins } from "./domains";
import { evidenceLibraryOAuthClientFields } from "./validators";
import { readEvidenceLibraryAdminLaunchTarget } from "./setupRecords";

/** Where Better Auth in the library receives OpenScholar's answer. */
export const LIBRARY_OAUTH_CALLBACK_PATH = "/api/auth/callback/openscholar";

/** Long enough for every Clerk call one sync makes, each limited to 15 seconds. */
const OAUTH_CLIENT_LEASE_MS = 3 * 60_000;

/** Clerk does not keep names unique, so the library ID makes this one ours. */
export function libraryOAuthApplicationName(libraryId: string) {
  return `evidence-library-${libraryId}`;
}

export function libraryOAuthRedirectUris(origins: readonly string[]) {
  return [...new Set(origins.map((origin) => new URL(LIBRARY_OAUTH_CALLBACK_PATH, new URL(origin).origin).toString()))].sort();
}

const oauthClientValidator = v.object({
  _id: v.id("evidenceLibraryOAuthClients"),
  _creationTime: v.number(),
  ...evidenceLibraryOAuthClientFields,
});

async function readRow(ctx: Pick<QueryCtx, "db">, libraryId: Id<"evidenceLibraries">) {
  return await ctx.db
    .query("evidenceLibraryOAuthClients")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId))
    .unique();
}

/** The row, only for the sync holding its lease. */
async function requireLeasedRow(ctx: MutationCtx, libraryId: Id<"evidenceLibraries">, token: string) {
  const row = await readRow(ctx, libraryId);
  if (!row || row.lease?.token !== token) {
    throw new Error("The OAuth application sync lost its lease");
  }
  return row;
}

export const readOAuthClient = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(v.null(), oauthClientValidator),
  handler: async (ctx, args) => await readRow(ctx, args.libraryId),
});

/**
 * Takes the library's sync lease, recording the intent to provision first if
 * there is no row yet. Answers false while another sync holds it.
 */
export const claimOAuthClientLease = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const lease = { token: args.token, expiresAt: now + OAUTH_CLIENT_LEASE_MS };
    const row = await readRow(ctx, args.libraryId);
    if (!row) {
      await ctx.db.insert("evidenceLibraryOAuthClients", {
        libraryId: args.libraryId,
        intentAt: now,
        redirectUris: [],
        lease,
        updatedAt: now,
      });
      return true;
    }
    if (row.lease && row.lease.expiresAt > now && row.lease.token !== args.token) return false;
    await ctx.db.patch("evidenceLibraryOAuthClients", row._id, { lease, updatedAt: now });
    return true;
  },
});

export const releaseOAuthClientLease = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await readRow(ctx, args.libraryId);
    if (row?.lease?.token === args.token) {
      await ctx.db.patch("evidenceLibraryOAuthClients", row._id, { lease: undefined });
    }
    return null;
  },
});

/** Saves what Clerk answered, in the same step that received it. */
export const saveOAuthClient = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    token: v.string(),
    applicationId: v.string(),
    clientId: v.string(),
    discoveryUrl: v.string(),
    redirectUris: v.array(v.string()),
    encryptedClientSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await requireLeasedRow(ctx, args.libraryId, args.token);
    const { libraryId: _libraryId, token: _token, ...fields } = args;
    await ctx.db.patch("evidenceLibraryOAuthClients", row._id, {
      ...fields,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Forgets an application Clerk no longer has, so the next step makes a new one. */
export const forgetOAuthApplication = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await requireLeasedRow(ctx, args.libraryId, args.token);
    await ctx.db.patch("evidenceLibraryOAuthClients", row._id, {
      applicationId: undefined,
      clientId: undefined,
      encryptedClientSecret: undefined,
      discoveryUrl: undefined,
      redirectUris: [],
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const recordOAuthClientError = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    error: v.object({
      status: v.optional(v.number()),
      code: v.optional(v.string()),
      traceId: v.optional(v.string()),
      message: v.string(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await readRow(ctx, args.libraryId);
    if (row) {
      await ctx.db.patch("evidenceLibraryOAuthClients", row._id, {
        lastError: { ...args.error, at: Date.now() },
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const removeOAuthClientRecord = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await requireLeasedRow(ctx, args.libraryId, args.token);
    await ctx.db.delete("evidenceLibraryOAuthClients", row._id);
    return null;
  },
});

const LIBRARY_PAGE_SIZE = 25;

/**
 * Every live library and the addresses it answers on, a page at a time: what
 * gives libraries made before OAuth applications existed their own. The
 * platform address stays even when a custom domain is the library's main one,
 * because it keeps sending visitors on.
 */
export const readLiveLibraryOrigins = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    libraries: v.array(v.object({ libraryId: v.id("evidenceLibraries"), origins: v.array(v.string()) })),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("evidenceLibraries")
      .paginate({ numItems: LIBRARY_PAGE_SIZE, cursor: args.cursor });
    const libraries = [];
    for (const library of page.page) {
      const liveOrigin = await readEvidenceLibraryAdminLaunchTarget(ctx, library);
      const binding = library.runtimeBindingId
        ? await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId)
        : null;
      if (!liveOrigin || !binding) continue;
      libraries.push({
        libraryId: library._id,
        origins: [binding.targetBaseUrl, liveOrigin, ...(await readAttachedDomainOrigins(ctx, library._id))],
      });
    }
    return { libraries, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});
