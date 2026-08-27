import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { evidenceLibraryAddressMoveValidator } from "../evidenceLibraries/validators";

/**
 * Development helper. Address recovery only happens when a real host answers
 * as another site, which no test deployment can arrange. These mutations write
 * the same rows the platform writes, so the pages can be checked in a browser.
 * They are internal: nothing in the app can call them.
 */
export const seedAddressMove = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    move: evidenceLibraryAddressMoveValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const library = await ctx.db.get("evidenceLibraries", args.libraryId);
    if (!library?.setupOperationId) {
      throw createError("NOT_FOUND", "This library has no setup operation");
    }
    await ctx.db.patch(library.setupOperationId, { addressMove: args.move });
    return null;
  },
});
