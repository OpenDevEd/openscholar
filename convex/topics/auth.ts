import type { QueryCtx, MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { findMatchingLibraryServiceCredential } from "../evidenceLibraries/credentials";
export async function authenticate(ctx: Pick<QueryCtx | MutationCtx, "db">, library: string, credentialDigest: string) {
  const libraryId = ctx.db.normalizeId("evidenceLibraries", library);
  if (!libraryId) throw createError("VALIDATION_ERROR", "Invalid library ID");
  if (!await findMatchingLibraryServiceCredential(ctx, {libraryId, credentialDigest})) {
    const known = await ctx.db.query("evidenceLibraryCredentials").withIndex("by_credentialDigest", q => q.eq("credentialDigest", credentialDigest)).first();
    throw createError(known ? "FORBIDDEN" : "UNAUTHENTICATED", "Invalid library credential");
  }
  const row = await ctx.db.get("evidenceLibraries", libraryId);
  if (!row || row.state === "disabled") throw createError("FORBIDDEN", "Library unavailable");
  return libraryId;
}
