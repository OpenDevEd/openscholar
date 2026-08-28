"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { decrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import {
  type RuntimeCollectionFacts,
  type RuntimeCollectionsPage,
  type RuntimeInstitutionsPage,
  RuntimeReadError,
  RUNTIME_RESOLVE_MAX_IDS,
  readRuntimeCollections,
  readRuntimeCollectionsByIds,
  readRuntimeInstitutions,
  runtimeReadCacheKey,
} from "./runtimeReadClient";

const collectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  count: v.number(),
  source: v.string(),
  parentId: v.union(v.string(), v.null()),
});

const institutionValidator = v.object({ name: v.string(), count: v.number() });

const collectionFactsValidator = v.object({
  id: v.string(),
  title: v.string(),
  source: v.string(),
  count: v.number(),
});

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
      { libraryId: args.libraryId, kind: "collections", cacheKey: runtimeReadCacheKey(args) },
      (target) =>
        readRuntimeCollections(fetch, { ...target, query: args.query, cursor: args.cursor }),
    );
    return "reason" in result ? { ...result, items: [], nextCursor: null } : result;
  },
});

export const listRecordInstitutions = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    query: v.optional(v.string()),
    cursor: v.optional(v.string()),
    sort: v.optional(v.union(v.literal("count"), v.literal("name"))),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: v.object({
    reason: notSetUpValidator,
    items: v.array(institutionValidator),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<RuntimeInstitutionsPage & { reason?: "not-set-up" }> => {
    const result = await cachedRead<RuntimeInstitutionsPage>(
      ctx,
      { libraryId: args.libraryId, kind: "institutions", cacheKey: runtimeReadCacheKey(args) },
      (target) =>
        readRuntimeInstitutions(fetch, {
          ...target,
          query: args.query,
          cursor: args.cursor,
          sort: args.sort,
          direction: args.direction,
        }),
    );
    return "reason" in result ? { ...result, items: [], nextCursor: null } : result;
  },
});

/**
 * The names and record counts of collections the site already shows, so the
 * Collections section and every link editor can name them. A library that
 * cannot answer ids yet gives an empty list, and the page shows the id.
 */
export const resolveLibraryCollections = action({
  args: { libraryId: v.id("evidenceLibraries"), ids: v.array(v.string()) },
  returns: v.object({
    reason: notSetUpValidator,
    items: v.array(collectionFactsValidator),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ items: RuntimeCollectionFacts[]; reason?: "not-set-up" }> => {
    const ids = [...new Set(args.ids)].slice(0, RUNTIME_RESOLVE_MAX_IDS);
    if (ids.length === 0) return { items: [] };
    const result = await cachedRead<{ items: RuntimeCollectionFacts[] }>(
      ctx,
      { libraryId: args.libraryId, kind: "collections", cacheKey: runtimeReadCacheKey({ ids }) },
      (target) => readRuntimeCollectionsByIds(fetch, { ...target, ids }),
    );
    return "reason" in result ? { ...result, items: [] } : result;
  },
});
