import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import {
  evidenceLibraryAddressMoveValidator,
  evidenceLibraryAddressStateValidator,
} from "../evidenceLibraries/validators";

/**
 * Development helper. Address recovery only happens when a real host answers
 * as another site, which no test deployment can arrange. These mutations write
 * the same rows the platform writes, so the pages can be checked in a browser.
 * They are internal: nothing in the app can call them.
 */
export const seedAddressState = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    addressState: evidenceLibraryAddressStateValidator,
    // Marks the library live as well, so the pages that only speak about
    // running libraries have something to show.
    live: v.optional(v.boolean()),
    // Forgets the answer instead of writing one.
    forget: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const library = await ctx.db.get("evidenceLibraries", args.libraryId);
    if (!library?.runtimeBindingId) {
      throw createError("NOT_FOUND", "This library has no runtime binding");
    }
    await ctx.db.patch(library.runtimeBindingId, {
      addressState: args.forget ? undefined : args.addressState,
      addressCheckedAt: args.forget ? undefined : Date.now(),
    });
    if (args.live) {
      await ctx.db.patch(library._id, {
        state: "active",
        activeRevisionId: library.latestRevisionId,
      });
    }
    return null;
  },
});

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
