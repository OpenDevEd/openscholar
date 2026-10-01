"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { decrypt } from "../lib/crypto";
import { deleteRuntimeReader, RuntimeReadError } from "../zotero/runtimeReadClient";
import { requireRuntimeEnvironment } from "./runtimeActionConfig";

export const deleteReaderFromLibrary = internalAction({
  args: { deletionId: v.id("evidenceLibraryReaderDeletions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deletion = await ctx.runQuery(
      internal.evidenceLibraries.readerDeletions.readReaderDeletionTarget,
      args,
    );
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
      await ctx.runMutation(internal.evidenceLibraries.readerDeletions.retryReaderDeletion, {
        ...args,
        error: failure,
      });
    }
    return null;
  },
});
