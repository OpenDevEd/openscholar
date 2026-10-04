import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
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
 * there is no row yet. `busy` while another sync holds it. `gone` when a sync
 * finds the library deleted or being deleted, so a late one cannot bring back
 * the application its teardown removed.
 */
export const claimOAuthClientLease = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    token: v.string(),
    purpose: v.union(v.literal("sync"), v.literal("delete")),
  },
  returns: v.union(v.literal("claimed"), v.literal("busy"), v.literal("gone")),
  handler: async (ctx, args) => {
    if (args.purpose === "sync") {
      const library = await ctx.db.get("evidenceLibraries", args.libraryId);
      const teardown = await ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_idempotencyKey", (q) =>
          q.eq("libraryId", args.libraryId).eq("idempotencyKey", `development-teardown:${args.libraryId}`),
        )
        .unique();
      if (!library || teardown) return "gone";
    }
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
      return "claimed";
    }
    if (row.lease && row.lease.expiresAt > now && row.lease.token !== args.token) return "busy";
    await ctx.db.patch("evidenceLibraryOAuthClients", row._id, { lease, updatedAt: now });
    return "claimed";
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

async function readLiveOrigins(ctx: QueryCtx, library: Doc<"evidenceLibraries">) {
  const liveOrigin = await readEvidenceLibraryAdminLaunchTarget(ctx, library);
  const binding = library.runtimeBindingId
    ? await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId)
    : null;
  if (!liveOrigin || !binding) return null;
  return [binding.targetBaseUrl, liveOrigin, ...(await readAttachedDomainOrigins(ctx, library._id))];
}

/**
 * The addresses a live library answers on now, or null when it is not live.
 * The platform address stays even when a custom domain is the library's main
 * one, because it keeps sending visitors on.
 */
export const readLibraryLiveOrigins = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(v.null(), v.array(v.string())),
  handler: async (ctx, args) => {
    const library = await ctx.db.get("evidenceLibraries", args.libraryId);
    return library ? await readLiveOrigins(ctx, library) : null;
  },
});

/** The live libraries on one page of the library list, for the backfill. */
export const readLiveLibraryPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    libraryIds: v.array(v.id("evidenceLibraries")),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("evidenceLibraries")
      .paginate({ numItems: LIBRARY_PAGE_SIZE, cursor: args.cursor });
    const libraryIds = [];
    for (const library of page.page) {
      if (await readLiveOrigins(ctx, library)) libraryIds.push(library._id);
    }
    return { libraryIds, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});
