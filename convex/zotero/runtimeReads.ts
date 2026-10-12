import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { actingArg, signedInAs } from "../lib/userActions";
import { requireEvidenceLibraryAccess } from "../evidenceLibraries/access";
import { readLibraryRuntimeTarget } from "../evidenceLibraries/runtimeTarget";

// Answering anything about a library starts with the right to view it (what it holds, as its settings
// page shows everyone who views it, #653) or to manage it (asking it to act), even when the caller
// asked about nothing at all.
export const requireRuntimeReadAccess = internalQuery({
  args: { libraryId: v.id("evidenceLibraries"), action: v.union(v.literal("view"), v.literal("manage")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, args.action);
    return null;
  },
});

// Where a library answers reads, and the encrypted machine credential that
// opens its read API. `null` while the library is not set up yet.
export const readRuntimeReadTarget = internalQuery({
  args: { ...actingArg, libraryId: v.id("evidenceLibraries"), action: v.union(v.literal("view"), v.literal("manage")) },
  returns: v.union(
    v.null(),
    v.object({
      targetBaseUrl: v.string(),
      encryptedMachineCredential: v.string(),
    }),
  ),
  handler: async (caller, { actingAs: as, ...args }) => {
    const ctx = await signedInAs(caller, as);
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, args.action);
    return await readLibraryRuntimeTarget(ctx, access.library);
  },
});
