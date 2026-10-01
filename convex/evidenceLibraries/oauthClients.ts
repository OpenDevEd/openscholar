import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { readAttachedDomainOrigins } from "./domains";
import { evidenceLibraryOAuthClientFields } from "./validators";
import { readEvidenceLibraryAdminLaunchTarget } from "./setupRecords";

/** Where Better Auth in the library receives OpenScholar's answer. */
export const LIBRARY_OAUTH_CALLBACK_PATH = "/api/auth/callback/openscholar";

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

export const readOAuthClient = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(v.null(), oauthClientValidator),
  handler: async (ctx, args) =>
    await ctx.db
      .query("evidenceLibraryOAuthClients")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.libraryId))
      .unique(),
});

/** Written before Clerk is asked to create the application. */
export const recordOAuthClientIntent = internalMutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("evidenceLibraryOAuthClients")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.libraryId))
      .unique();
    if (existing) return null;
    const now = Date.now();
    await ctx.db.insert("evidenceLibraryOAuthClients", {
      libraryId: args.libraryId,
      intentAt: now,
      redirectUris: [],
      updatedAt: now,
    });
    return null;
  },
});

/** Saves what Clerk answered, in the same step that received it. */
export const saveOAuthClient = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    applicationId: v.string(),
    clientId: v.string(),
    discoveryUrl: v.string(),
    redirectUris: v.array(v.string()),
    encryptedClientSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("evidenceLibraryOAuthClients")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.libraryId))
      .unique();
    if (!row) throw new Error("The OAuth client intent is missing");
    const { libraryId: _libraryId, ...fields } = args;
    await ctx.db.patch("evidenceLibraryOAuthClients", row._id, {
      ...fields,
      lastError: undefined,
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
    const row = await ctx.db
      .query("evidenceLibraryOAuthClients")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.libraryId))
      .unique();
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
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("evidenceLibraryOAuthClients")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.libraryId))
      .unique();
    if (row) await ctx.db.delete("evidenceLibraryOAuthClients", row._id);
    return null;
  },
});

const LIBRARY_PAGE_SIZE = 25;

/**
 * Every live library and the addresses it answers on, a page at a time: what
 * gives libraries made before OAuth applications existed their own.
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
      const targetBaseUrl = await readEvidenceLibraryAdminLaunchTarget(ctx, library);
      if (!targetBaseUrl) continue;
      libraries.push({
        libraryId: library._id,
        origins: [targetBaseUrl, ...(await readAttachedDomainOrigins(ctx, library._id))],
      });
    }
    return { libraries, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});
