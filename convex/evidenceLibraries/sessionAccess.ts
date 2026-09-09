import type { QueryCtx, MutationCtx } from "../_generated/server";
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { findMatchingLibraryServiceCredential } from "./credentials";
import { readLibraryRole } from "./access";
import { evidenceLibraryAdminRoleValidator } from "./validators";

export const readSessionAccess = internalQuery({
  args: { libraryId: v.string(), clerkUserId: v.string(), credentialDigest: v.string() },
  returns: v.union(v.null(), v.object({ role: evidenceLibraryAdminRoleValidator })),
  handler: readLibrarySessionAccess,
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
