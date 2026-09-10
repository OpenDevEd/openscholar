import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { LIBRARY_SERVICE_CREDENTIAL_KEY } from "./credentials";
import { readEvidenceLibraryAdminLaunchTarget } from "./setupRecords";

/** Callers must check the user's library permission before reading this credential. */
export async function readLibraryRuntimeTarget(ctx: QueryCtx, library: Doc<"evidenceLibraries">) {
  const targetBaseUrl = await readEvidenceLibraryAdminLaunchTarget(ctx, library);
  if (!targetBaseUrl) return null;
  const credential = await ctx.db.query("evidenceLibraryCredentials")
    .withIndex("by_libraryId_and_credentialKey", q => q.eq("libraryId", library._id).eq("credentialKey", LIBRARY_SERVICE_CREDENTIAL_KEY))
    .unique();
  return credential ? { targetBaseUrl, encryptedMachineCredential: credential.encryptedValue } : null;
}
