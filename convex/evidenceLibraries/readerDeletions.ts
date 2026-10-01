import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { readLibraryRuntimeTarget } from "./runtimeTarget";

const LIBRARY_PAGE_SIZE = 50;
/**
 * Minutes from each attempt to the next; about a day in all. The last entry
 * is the wait before a deletion that never got through is marked failed.
 */
const RETRY_DELAY_MINUTES = [1, 5, 30, 120, 360, 720, 60];
export const READER_DELETION_MAX_ATTEMPTS = RETRY_DELAY_MINUTES.length;

/** Called from the Clerk `user.deleted` projection once it has applied. */
export async function queueReaderDeletion(ctx: MutationCtx, clerkUserId: string) {
  await ctx.scheduler.runAfter(0, internal.evidenceLibraries.readerDeletions.fanOutReaderDeletion, {
    clerkUserId,
    cursor: null,
  });
}

export const fanOutReaderDeletion = internalMutation({
  args: { clerkUserId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("evidenceLibraries")
      .paginate({ numItems: LIBRARY_PAGE_SIZE, cursor: args.cursor });
    for (const library of page.page) {
      // A library that never went live has no readers.
      if (!library.runtimeBindingId) continue;
      const existing = await ctx.db
        .query("evidenceLibraryReaderDeletions")
        .withIndex("by_libraryId_and_clerkUserId", (q) =>
          q.eq("libraryId", library._id).eq("clerkUserId", args.clerkUserId),
        )
        .unique();
      if (existing) continue;
      const now = Date.now();
      const deletionId = await ctx.db.insert("evidenceLibraryReaderDeletions", {
        libraryId: library._id,
        clerkUserId: args.clerkUserId,
        attempts: 0,
        state: "pending",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.readerDeletionActions.deleteReaderFromLibrary, {
        deletionId,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.readerDeletions.fanOutReaderDeletion, {
        clerkUserId: args.clerkUserId,
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

/**
 * Starts one attempt: counts it and schedules the next before the library is
 * called, so an attempt that dies on the way still has a successor. The call
 * after the last attempt only marks the deletion failed.
 */
export const beginReaderDeletionAttempt = internalMutation({
  args: { deletionId: v.id("evidenceLibraryReaderDeletions") },
  returns: v.union(
    v.null(),
    v.object({
      clerkUserId: v.string(),
      libraryId: v.id("evidenceLibraries"),
      target: v.union(
        v.null(),
        v.object({ targetBaseUrl: v.string(), encryptedMachineCredential: v.string() }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const deletion = await ctx.db.get("evidenceLibraryReaderDeletions", args.deletionId);
    if (!deletion || deletion.state !== "pending") return null;
    if (deletion.attempts >= READER_DELETION_MAX_ATTEMPTS) {
      await ctx.db.patch("evidenceLibraryReaderDeletions", deletion._id, { state: "failed", updatedAt: Date.now() });
      console.error("[evidence-library] reader deletion gave up", {
        libraryId: deletion.libraryId,
        attempts: deletion.attempts,
        error: deletion.lastError,
      });
      return null;
    }
    const attempts = deletion.attempts + 1;
    await ctx.db.patch("evidenceLibraryReaderDeletions", deletion._id, { attempts, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(
      RETRY_DELAY_MINUTES[attempts - 1] * 60_000,
      internal.evidenceLibraries.readerDeletionActions.deleteReaderFromLibrary,
      args,
    );
    const library = await ctx.db.get("evidenceLibraries", deletion.libraryId);
    return {
      clerkUserId: deletion.clerkUserId,
      libraryId: deletion.libraryId,
      target: library ? await readLibraryRuntimeTarget(ctx, library) : null,
    };
  },
});

/** The library confirmed: nothing more to do, and the scheduled successor finds no row. */
export const finishReaderDeletion = internalMutation({
  args: { deletionId: v.id("evidenceLibraryReaderDeletions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.db.get("evidenceLibraryReaderDeletions", args.deletionId)) {
      await ctx.db.delete("evidenceLibraryReaderDeletions", args.deletionId);
    }
    return null;
  },
});

export const recordReaderDeletionFailure = internalMutation({
  args: {
    deletionId: v.id("evidenceLibraryReaderDeletions"),
    error: v.object({ status: v.optional(v.number()), message: v.string() }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deletion = await ctx.db.get("evidenceLibraryReaderDeletions", args.deletionId);
    if (deletion?.state === "pending") {
      await ctx.db.patch("evidenceLibraryReaderDeletions", deletion._id, {
        lastError: args.error,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
