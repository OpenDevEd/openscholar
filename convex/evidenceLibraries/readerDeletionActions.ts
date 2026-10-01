"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { decrypt } from "../lib/crypto";
import { deleteRuntimeReader, RuntimeReadError } from "../zotero/runtimeReadClient";
import { requireRuntimeEnvironment } from "./runtimeActionConfig";

/**
 * One attempt to make a library drop a deleted reader. The next attempt is
 * already scheduled when this one starts, so a failure here only records why.
 */
export const deleteReaderFromLibrary = internalAction({
  args: { deletionId: v.id("evidenceLibraryReaderDeletions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deletion: {
      clerkUserId: string;
      libraryId: Id<"evidenceLibraries">;
      target: { targetBaseUrl: string; encryptedMachineCredential: string } | null;
    } | null = await ctx.runMutation(internal.evidenceLibraries.readerDeletions.beginReaderDeletionAttempt, args);
    if (!deletion) return null;
    try {
      // A library that is no longer live has no readers left to remove.
      if (deletion.target) {
        const encryptionKey = requireRuntimeEnvironment("ENCRYPTION_KEY", (message) => new Error(message));
        await deleteRuntimeReader(
          fetch,
          {
            baseUrl: deletion.target.targetBaseUrl,
            credential: decrypt(deletion.target.encryptedMachineCredential, encryptionKey),
          },
          deletion.clerkUserId,
        );
      }
      await ctx.runMutation(internal.evidenceLibraries.readerDeletions.finishReaderDeletion, args);
    } catch (error) {
      const failure = {
        ...(error instanceof RuntimeReadError && error.status !== undefined ? { status: error.status } : {}),
        message: error instanceof Error ? error.message : String(error),
      };
      console.warn("[evidence-library] reader deletion call failed", {
        libraryId: deletion.libraryId,
        ...failure,
      });
      await ctx.runMutation(internal.evidenceLibraries.readerDeletions.recordReaderDeletionFailure, {
        ...args,
        error: failure,
      });
    }
    return null;
  },
});
