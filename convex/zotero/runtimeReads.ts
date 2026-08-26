import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { requireEvidenceLibraryAccess } from "../evidenceLibraries/access";
import { LIBRARY_SERVICE_CREDENTIAL_KEY } from "../evidenceLibraries/credentials";
import { readEvidenceLibraryAdminLaunchTarget } from "../evidenceLibraries/setupRecords";
import { isFreshRuntimeRead } from "./runtimeReadClient";

export const runtimeReadKindValidator = v.union(
  v.literal("collections"),
  v.literal("institutions"),
);

// Where a library answers reads, and the encrypted machine credential that
// opens its read API. `null` while the library is not set up yet.
export const readRuntimeReadTarget = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(
    v.null(),
    v.object({ targetBaseUrl: v.string(), encryptedMachineCredential: v.string() }),
  ),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const targetBaseUrl = await readEvidenceLibraryAdminLaunchTarget(ctx, access.library);
    if (!targetBaseUrl) return null;
    const credential = await ctx.db
      .query("evidenceLibraryCredentials")
      .withIndex("by_libraryId_and_credentialKey", (q) =>
        q.eq("libraryId", args.libraryId).eq("credentialKey", LIBRARY_SERVICE_CREDENTIAL_KEY),
      )
      .unique();
    if (!credential) return null;
    return { targetBaseUrl, encryptedMachineCredential: credential.encryptedValue };
  },
});

// Checks that the caller may manage the library before answering from the
// cache, so a warm cache never leaks another library's data.
export const readRuntimeReadCache = internalQuery({
  args: {
    libraryId: v.id("evidenceLibraries"),
    kind: runtimeReadKindValidator,
    cacheKey: v.string(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const row = await ctx.db
      .query("evidenceLibraryRuntimeReadCache")
      .withIndex("by_libraryId_and_kind_and_cacheKey", (q) =>
        q.eq("libraryId", args.libraryId).eq("kind", args.kind).eq("cacheKey", args.cacheKey),
      )
      .unique();
    return row && isFreshRuntimeRead(row.fetchedAt, Date.now()) ? row.payload : null;
  },
});

export const writeRuntimeReadCache = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    kind: runtimeReadKindValidator,
    cacheKey: v.string(),
    payload: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("evidenceLibraryRuntimeReadCache")
      .withIndex("by_libraryId_and_kind_and_cacheKey", (q) =>
        q.eq("libraryId", args.libraryId).eq("kind", args.kind).eq("cacheKey", args.cacheKey),
      )
      .unique();
    const fields = { ...args, fetchedAt: Date.now() };
    if (existing) {
      await ctx.db.replace("evidenceLibraryRuntimeReadCache", existing._id, fields);
    } else {
      await ctx.db.insert("evidenceLibraryRuntimeReadCache", fields);
    }
    return null;
  },
});
