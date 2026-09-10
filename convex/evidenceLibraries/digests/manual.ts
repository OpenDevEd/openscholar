import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import { readEvidenceLibraryAccess, requireEvidenceLibraryAccess } from "../access";
import { createError } from "../../lib/errors";
import { readLibraryRuntimeTarget } from "../runtimeTarget";

const args = { libraryId: v.id("evidenceLibraries") };

export const available = query({
  args,
  returns: v.boolean(),
  handler: async (ctx, { libraryId }) => {
    const access = await readEvidenceLibraryAccess(ctx, libraryId, "manage");
    return access?.organization.devEnabled === true && access.library.state === "active";
  },
});

export const target = internalQuery({
  args,
  returns: v.object({ targetBaseUrl: v.string(), encryptedMachineCredential: v.string() }),
  handler: async (ctx, { libraryId }) => {
    const access = await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
    if (access.organization.devEnabled !== true)
      throw createError("FORBIDDEN", "Manual digests are not enabled for this organization.");
    const target = await readLibraryRuntimeTarget(ctx, access.library);
    if (!target) throw createError("CONFLICT", "The library is not running yet.");
    return target;
  },
});
