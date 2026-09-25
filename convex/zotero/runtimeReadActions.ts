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
  type RuntimeReviewedPublicationsPage,
  RUNTIME_RESOLVE_MAX_IDS,
  RUNTIME_RESOLVE_MAX_TOTAL_IDS,
  readRuntimeCollections,
  readRuntimeCollectionsByIds,
  readRuntimeHomeQuestions,
  readRuntimeInstitutions,
  readRuntimeReviewedPublications,
} from "./runtimeReadClient";

const collectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  count: v.number(),
  source: v.string(),
  parentId: v.union(v.string(), v.null()),
  hasChildren: v.boolean(),
});

const institutionValidator = v.object({ name: v.string(), count: v.number() });

const reviewedPublicationValidator = v.object({
  key: v.string(),
  title: v.string(),
  publishedAt: v.string(),
  reviewer: v.string(),
  reviewed: v.boolean(),
});

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
  const target: {
    targetBaseUrl: string;
    encryptedMachineCredential: string;
  } | null = await ctx.runQuery(
    internal.zotero.runtimeReads.readRuntimeReadTarget,
    { libraryId },
  );
  if (!target) return null;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw createError(
      "API_KEY_ENCRYPTION_KEY_MISSING",
      "Encryption key not configured",
    );
  }
  return {
    baseUrl: target.targetBaseUrl,
    credential: decrypt(target.encryptedMachineCredential, encryptionKey),
  };
}

async function readRuntime<T>(
  ctx: ActionCtx,
  libraryId: Id<"evidenceLibraries">,
  read: (target: { baseUrl: string; credential: string }) => Promise<T>,
): Promise<T | NotSetUp> {
  const target = await readTarget(ctx, libraryId);
  if (!target) return { reason: "not-set-up" };
  try {
    return await read(target);
  } catch (error) {
    if (error instanceof RuntimeReadError) {
      throw createError("EVIDENCE_LIBRARY_RUNTIME_ERROR", error.message);
    }
    throw error;
  }
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
  handler: async (
    ctx,
    args,
  ): Promise<RuntimeCollectionsPage & { reason?: "not-set-up" }> => {
    const result = await readRuntime<RuntimeCollectionsPage>(
      ctx,
      args.libraryId,
      (target) =>
        readRuntimeCollections(fetch, {
          ...target,
          query: args.query,
          cursor: args.cursor,
        }),
    );
    return "reason" in result
      ? { ...result, items: [], nextCursor: null }
      : result;
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
  handler: async (
    ctx,
    args,
  ): Promise<RuntimeInstitutionsPage & { reason?: "not-set-up" }> => {
    const result = await readRuntime<RuntimeInstitutionsPage>(
      ctx,
      args.libraryId,
      (target) =>
        readRuntimeInstitutions(fetch, {
          ...target,
          query: args.query,
          cursor: args.cursor,
          sort: args.sort,
          direction: args.direction,
        }),
    );
    return "reason" in result
      ? { ...result, items: [], nextCursor: null }
      : result;
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
    await ctx.runQuery(internal.zotero.runtimeReads.requireRuntimeReadAccess, {
      libraryId: args.libraryId,
    });
    const ids = [...new Set(args.ids)];
    if (ids.length === 0) return { items: [] };
    if (ids.length > RUNTIME_RESOLVE_MAX_TOTAL_IDS) {
      throw createError(
        "VALIDATION_ERROR",
        `A site shows at most ${RUNTIME_RESOLVE_MAX_TOTAL_IDS} collections`,
      );
    }
    const result = await readRuntime(ctx, args.libraryId, async (target) => {
      // A site may show more collections than the library answers at once, so
      // the list is asked for in batches and put back together here.
      const found = new Map<string, RuntimeCollectionFacts>();
      for (let from = 0; from < ids.length; from += RUNTIME_RESOLVE_MAX_IDS) {
        const batch = ids.slice(from, from + RUNTIME_RESOLVE_MAX_IDS);
        const page = await readRuntimeCollectionsByIds(fetch, {
          ...target,
          ids: batch,
        });
        for (const item of page.items) found.set(item.id, item);
      }
      return {
        items: ids.flatMap((id) => {
          const item = found.get(id);
          return item ? [item] : [];
        }),
      };
    });
    return "reason" in result ? { reason: "not-set-up", items: [] } : result;
  },
});

/**
 * Publications with a PDF, reviewed or not, for the home page's "publication
 * followed" choice. `ids` names chosen publications instead of searching.
 */
export const listReviewedPublications = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    query: v.optional(v.string()),
    cursor: v.optional(v.string()),
    ids: v.optional(v.array(v.string())),
  },
  returns: v.object({
    reason: notSetUpValidator,
    items: v.array(reviewedPublicationValidator),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<RuntimeReviewedPublicationsPage & { reason?: "not-set-up" }> => {
    const result = await readRuntime<RuntimeReviewedPublicationsPage>(
      ctx,
      args.libraryId,
      (target) =>
        readRuntimeReviewedPublications(fetch, {
          ...target,
          query: args.query,
          cursor: args.cursor,
          ids: args.ids,
        }),
    );
    return "reason" in result
      ? { ...result, items: [], nextCursor: null }
      : result;
  },
});

/** The questions the home page asks in the slots the owner leaves empty. */
export const readHomeQuestions = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    reason: notSetUpValidator,
    questions: v.array(v.union(v.string(), v.null())),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ questions: (string | null)[]; reason?: "not-set-up" }> => {
    const result = await readRuntime(ctx, args.libraryId, async (target) => ({
      questions: await readRuntimeHomeQuestions(fetch, target),
    }));
    return "reason" in result ? { reason: "not-set-up", questions: [] } : result;
  },
});
