"use node";

import { paginationOptsValidator, type PaginationOptions } from "convex/server";
import { type GenericValidator, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { decrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import {
  type RuntimeCollection,
  type RuntimeCollectionFacts,
  type RuntimeCollectionsPage,
  type RuntimeInstitution,
  type RuntimeInstitutionsPage,
  RuntimeReadError,
  type RuntimeReviewedPublication,
  type RuntimeReviewedPublicationsPage,
  RUNTIME_READ_PAGE_SIZE,
  RUNTIME_RESOLVE_MAX_IDS,
  RUNTIME_RESOLVE_MAX_TOTAL_IDS,
  readRuntimeCollections,
  readRuntimeCollectionsByIds,
  readRuntimeHomeQuestions,
  readRuntimeInstitutions,
  readRuntimeReviewedPublications,
  requestRuntimeSourceRun,
} from "./runtimeReadClient";
import {
  homeQuestionsValidator,
  resolvedCollectionsValidator,
} from "./runtimeReadValidators";

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

// `reason: "not-set-up"` means the library has no running runtime yet, so
// there is nothing to read and the list is empty.
const notSetUpValidator = v.optional(v.literal("not-set-up"));
type NotSetUp = { reason: "not-set-up" };

/** One page of a library's own list, as the library pages it. */
const runtimePage = <Item extends GenericValidator>(item: Item) =>
  v.object({
    reason: notSetUpValidator,
    page: v.array(item),
    isDone: v.boolean(),
    continueCursor: v.string(),
  });
type RuntimePage<Item> = {
  reason?: "not-set-up";
  page: Item[];
  isDone: boolean;
  continueCursor: string;
};

/** The cursor and page size the library is asked with: its own, never more than a page. */
const asked = ({ cursor, numItems }: PaginationOptions) => ({
  cursor: cursor ?? undefined,
  pageSize: Math.min(Math.max(1, Math.floor(numItems)), RUNTIME_READ_PAGE_SIZE),
});

const pageOf = <Item>(
  result: { items: Item[]; nextCursor: string | null } | NotSetUp,
): RuntimePage<Item> =>
  "reason" in result
    ? { ...result, page: [], isDone: true, continueCursor: "" }
    : {
        page: result.items,
        isDone: result.nextCursor === null,
        continueCursor: result.nextCursor ?? "",
      };

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

/** One page of the library's collections, searched by `query`. */
export const listCollections = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    query: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: runtimePage(collectionValidator),
  handler: async (ctx, args): Promise<RuntimePage<RuntimeCollection>> =>
    pageOf(
      await readRuntime<RuntimeCollectionsPage>(ctx, args.libraryId, (target) =>
        readRuntimeCollections(fetch, {
          ...target,
          query: args.query,
          ...asked(args.paginationOpts),
        }),
      ),
    ),
});

/** Kept for one release, while the deployed site still calls it; `listCollections` replaces it. */
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

/** One page of the institutions named on the library's records. */
export const listInstitutions = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    query: v.optional(v.string()),
    sort: v.optional(v.union(v.literal("count"), v.literal("name"))),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    paginationOpts: paginationOptsValidator,
  },
  returns: runtimePage(institutionValidator),
  handler: async (ctx, args): Promise<RuntimePage<RuntimeInstitution>> =>
    pageOf(
      await readRuntime<RuntimeInstitutionsPage>(ctx, args.libraryId, (target) =>
        readRuntimeInstitutions(fetch, {
          ...target,
          query: args.query,
          sort: args.sort,
          direction: args.direction,
          ...asked(args.paginationOpts),
        }),
      ),
    ),
});

/** Kept for one release, while the deployed site still calls it; `listInstitutions` replaces it. */
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
    items: resolvedCollectionsValidator,
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
 * One page of the publications with a PDF, reviewed or not, for the home
 * page's "publication followed" choice.
 */
export const listPublications = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    query: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: runtimePage(reviewedPublicationValidator),
  handler: async (
    ctx,
    args,
  ): Promise<RuntimePage<RuntimeReviewedPublication>> =>
    pageOf(
      await readRuntime<RuntimeReviewedPublicationsPage>(
        ctx,
        args.libraryId,
        (target) =>
          readRuntimeReviewedPublications(fetch, {
            ...target,
            query: args.query,
            ...asked(args.paginationOpts),
          }),
      ),
    ),
});

/** The publication with this key, for the title of a saved choice; null when the library has none. */
export const readPublication = action({
  args: { libraryId: v.id("evidenceLibraries"), key: v.string() },
  returns: v.union(reviewedPublicationValidator, v.null()),
  handler: async (ctx, args): Promise<RuntimeReviewedPublication | null> => {
    const result = await readRuntime<RuntimeReviewedPublicationsPage>(
      ctx,
      args.libraryId,
      (target) =>
        readRuntimeReviewedPublications(fetch, { ...target, ids: [args.key] }),
    );
    return "reason" in result
      ? null
      : (result.items.find((item) => item.key === args.key) ?? null);
  },
});

/** Kept for one release, while the deployed site still calls it; `listPublications` and `readPublication` replace it. */
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
    questions: homeQuestionsValidator,
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

/** "Retry import": the library runs the source within seconds. */
export const requestSourceRun = action({
  args: { libraryId: v.id("evidenceLibraries"), sourceKey: v.string() },
  returns: v.object({ reason: notSetUpValidator }),
  handler: async (ctx, args): Promise<{ reason?: "not-set-up" }> => {
    const result = await readRuntime(ctx, args.libraryId, async (target) => {
      await requestRuntimeSourceRun(fetch, target, args.sourceKey);
      return {};
    });
    return "reason" in result ? { reason: "not-set-up" } : {};
  },
});
