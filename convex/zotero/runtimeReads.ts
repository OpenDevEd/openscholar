import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { requireEvidenceLibraryAccess } from "../evidenceLibraries/access";
import { readLibraryRuntimeTarget } from "../evidenceLibraries/runtimeTarget";

// Answering anything about a library starts with the right to manage it,
// even when the caller asked about nothing at all.
export const requireRuntimeReadAccess = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    return null;
  },
});

// Where a library answers reads, and the encrypted machine credential that
// opens its read API. `null` while the library is not set up yet.
export const readRuntimeReadTarget = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(
    v.null(),
    v.object({
      targetBaseUrl: v.string(),
      encryptedMachineCredential: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    return await readLibraryRuntimeTarget(ctx, access.library);
  },
});
