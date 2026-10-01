import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalQuery, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { readLibraryRuntimeTarget } from "./runtimeTarget";

const LIBRARY_PAGE_SIZE = 50;
/** Minutes to wait before each retry; about a day in all before giving up. */
const RETRY_DELAY_MINUTES = [1, 5, 30, 120, 360, 720];
export const READER_DELETION_MAX_ATTEMPTS = RETRY_DELAY_MINUTES.length + 1;

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

export const readReaderDeletionTarget = internalQuery({
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
    const library = await ctx.db.get("evidenceLibraries", deletion.libraryId);
    return {
      clerkUserId: deletion.clerkUserId,
      libraryId: deletion.libraryId,
      target: library ? await readLibraryRuntimeTarget(ctx, library) : null,
    };
  },
});

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

/** Records a failed call and schedules the next one, or gives up after the last. */
export const retryReaderDeletion = internalMutation({
  args: {
    deletionId: v.id("evidenceLibraryReaderDeletions"),
    error: v.object({ status: v.optional(v.number()), message: v.string() }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deletion = await ctx.db.get("evidenceLibraryReaderDeletions", args.deletionId);
    if (!deletion || deletion.state !== "pending") return null;
    const attempts = deletion.attempts + 1;
    const delayMinutes = RETRY_DELAY_MINUTES[attempts - 1];
    await ctx.db.patch("evidenceLibraryReaderDeletions", deletion._id, {
      attempts,
      lastError: args.error,
      updatedAt: Date.now(),
      ...(delayMinutes === undefined ? { state: "failed" as const } : {}),
    });
    if (delayMinutes === undefined) {
      console.error("[evidence-library] reader deletion gave up", {
        libraryId: deletion.libraryId,
        attempts,
        error: args.error,
      });
      return null;
    }
    await ctx.scheduler.runAfter(
      delayMinutes * 60_000,
      internal.evidenceLibraries.readerDeletionActions.deleteReaderFromLibrary,
      { deletionId: deletion._id },
    );
    return null;
  },
});
