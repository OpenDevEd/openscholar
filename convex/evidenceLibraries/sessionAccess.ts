import type { QueryCtx, MutationCtx } from "../_generated/server";
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { findMatchingLibraryServiceCredential } from "./credentials";
import { readLibraryRole } from "./access";
import { evidenceLibraryAdminRoleValidator } from "./validators";

/**
 * A refusal names the organisation that runs the library, so the library can
 * tell the person whom to ask for access.
 */
export const readSessionAccess = internalQuery({
  args: { libraryId: v.string(), clerkUserId: v.string(), credentialDigest: v.string() },
  returns: v.union(
    v.object({ role: evidenceLibraryAdminRoleValidator }),
    v.object({ denied: v.literal(true), organisationName: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx, args) => {
    const access = await readLibrarySessionAccess(ctx, args);
    if (access) return access;
    // The credential check above already proved the id names this library.
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    const library = libraryId ? await ctx.db.get("evidenceLibraries", libraryId) : null;
    const organization = library ? await ctx.db.get("organizations", library.organizationId) : null;
    return { denied: true as const, organisationName: organization?.name ?? null };
  },
});

/**
 * `unknown` covers an account the Clerk webhook has not delivered yet, so a
 * library never deletes data for a person who may still exist. A suspended
 * account keeps its data.
 */
export const readReaderStatus = internalQuery({
  args: { libraryId: v.string(), clerkUserId: v.string(), credentialDigest: v.string() },
  returns: v.union(v.literal("active"), v.literal("deleted"), v.literal("unknown")),
  handler: async (ctx, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId || !await findMatchingLibraryServiceCredential(ctx, { libraryId, credentialDigest: args.credentialDigest })) {
      throw createError("UNAUTHENTICATED", "Invalid library service credential");
    }
    const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", args.clerkUserId)).unique();
    if (!user) return "unknown";
    return user.state === "deleted" ? "deleted" : "active";
  },
});

export async function readLibrarySessionAccess(ctx: QueryCtx | MutationCtx, args: {libraryId: string; clerkUserId: string; credentialDigest: string}) {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId) throw createError("UNAUTHENTICATED", "Invalid library service credential");
    const credential = await findMatchingLibraryServiceCredential(ctx, { libraryId, credentialDigest: args.credentialDigest });
    if (!credential) throw createError("UNAUTHENTICATED", "Invalid library service credential");
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library || library.state === "disabled") return null;
    const role = await readLibraryRole(ctx, library, args.clerkUserId);
    return role ? { role } : null;

}
