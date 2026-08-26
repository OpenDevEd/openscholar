"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { decrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import {
  type RuntimeCollectionsPage,
  type RuntimeInstitution,
  RuntimeReadError,
  collectionsCacheKey,
  readRuntimeCollections,
  readRuntimeInstitutions,
} from "./runtimeReadClient";

const collectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  count: v.number(),
  source: v.string(),
  parentId: v.union(v.string(), v.null()),
});

const institutionValidator = v.object({ name: v.string(), count: v.number() });

// `reason: "not-set-up"` means the library has no running runtime yet, so
// there is nothing to read and the list is empty.
const notSetUpValidator = v.optional(v.literal("not-set-up"));
type NotSetUp = { reason: "not-set-up" };

async function readTarget(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">) {
  const target: { targetBaseUrl: string; encryptedMachineCredential: string } | null =
    await ctx.runQuery(internal.zotero.runtimeReads.readRuntimeReadTarget, { libraryId });
  if (!target) return null;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
  }
  return {
    baseUrl: target.targetBaseUrl,
    credential: decrypt(target.encryptedMachineCredential, encryptionKey),
  };
}

// Answers from the five-minute cache first; asks the library otherwise.
async function cachedRead<T>(
  ctx: ActionCtx,
  args: { libraryId: Id<"evidenceLibraries">; kind: "collections" | "institutions"; cacheKey: string },
  read: (target: { baseUrl: string; credential: string }) => Promise<T>,
): Promise<T | NotSetUp> {
  const cached: T | null = await ctx.runQuery(internal.zotero.runtimeReads.readRuntimeReadCache, args);
  if (cached !== null) return cached;
  const target = await readTarget(ctx, args.libraryId);
  if (!target) return { reason: "not-set-up" };
  let payload: T;
  try {
    payload = await read(target);
  } catch (error) {
    if (error instanceof RuntimeReadError) {
      throw createError("EVIDENCE_LIBRARY_RUNTIME_ERROR", error.message);
    }
    throw error;
  }
  await ctx.runMutation(internal.zotero.runtimeReads.writeRuntimeReadCache, { ...args, payload });
  return payload;
}

export const listLibraryCollections = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    query: v.optional(v.string()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    reason: notSetUpValidator,
    items: v.array(collectionValidator),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<RuntimeCollectionsPage & { reason?: "not-set-up" }> => {
    const result = await cachedRead<RuntimeCollectionsPage>(
      ctx,
      { libraryId: args.libraryId, kind: "collections", cacheKey: collectionsCacheKey(args) },
      (target) =>
        readRuntimeCollections(fetch, { ...target, query: args.query, cursor: args.cursor }),
    );
    return "reason" in result ? { ...result, items: [], nextCursor: null } : result;
  },
});

export const listRecordInstitutions = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({ reason: notSetUpValidator, items: v.array(institutionValidator) }),
  handler: async (
    ctx,
    args,
  ): Promise<{ items: RuntimeInstitution[]; reason?: "not-set-up" }> => {
    const result = await cachedRead<{ items: RuntimeInstitution[] }>(
      ctx,
      { libraryId: args.libraryId, kind: "institutions", cacheKey: "all" },
      (target) => readRuntimeInstitutions(fetch, target),
    );
    return "reason" in result ? { ...result, items: [] } : result;
  },
});
