"use node";

import { paginationOptsValidator, type PaginationOptions } from "convex/server";
import { type Infer, type ObjectType, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { decrypt } from "../lib/crypto";
import { createError, readConvexErrorData } from "../lib/errors";
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
  requestRuntimeScreeningGrade,
  requestRuntimeSourceRun,
  tryRuntimeScreeningSubject,
} from "./runtimeReadClient";
import {
  homeQuestionsValidator,
  notSetUpValidator,
  resolvedCollectionsValidator,
  reviewedPublicationValidator,
  runtimeCollectionValidator,
  runtimeInstitutionValidator,
  runtimePage,
  screeningTrialValidator,
} from "./runtimeReadValidators";

type NotSetUp = { reason: "not-set-up" };

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

/** The library a read is of, and with `actingAs` the person the assistant reads it for (../evidenceLibraries/assistant.ts). */
type Of = { libraryId: Id<"evidenceLibraries">; actingAs?: Id<"users"> };

async function readTarget(ctx: ActionCtx, { libraryId, actingAs }: Of, action: RuntimeAccess) {
  const target: {
    targetBaseUrl: string;
    encryptedMachineCredential: string;
  } | null = await ctx.runQuery(
    internal.zotero.runtimeReads.readRuntimeReadTarget,
    { libraryId, action, ...(actingAs ? { actingAs } : {}) },
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

/** What a call asks of the library: to view what it holds, which its settings page shows everyone who views it (#653), or to change it. */
type RuntimeAccess = "view" | "manage";

async function readRuntime<T>(
  ctx: ActionCtx,
  of: Of,
  action: RuntimeAccess,
  read: (target: { baseUrl: string; credential: string }) => Promise<T>,
): Promise<T | NotSetUp> {
  const target = await readTarget(ctx, of, action);
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
const listCollectionsArgs = {
  libraryId: v.id("evidenceLibraries"),
  query: v.optional(v.string()),
  paginationOpts: paginationOptsValidator,
};
const listCollectionsReturns = runtimePage(runtimeCollectionValidator);
const listCollectionsRead = async (ctx: ActionCtx, args: ObjectType<typeof listCollectionsArgs> & Of): Promise<RuntimePage<RuntimeCollection>> =>
  pageOf(
    await readRuntime<RuntimeCollectionsPage>(ctx, args, "view", (target) =>
      readRuntimeCollections(fetch, {
        ...target,
        query: args.query,
        ...asked(args.paginationOpts),
      }),
    ),
  );
export const listCollections = action({ args: listCollectionsArgs, returns: listCollectionsReturns, handler: listCollectionsRead });
/** The same, for the person the assistant acts for (../evidenceLibraries/assistant.ts). */
export const listCollectionsFor = internalAction({ args: { ...listCollectionsArgs, actingAs: v.id("users") }, returns: listCollectionsReturns, handler: listCollectionsRead });

/** One page of the institutions named on the library's records. */
const listInstitutionsArgs = {
  libraryId: v.id("evidenceLibraries"),
  query: v.optional(v.string()),
  sort: v.optional(v.union(v.literal("count"), v.literal("name"))),
  direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  paginationOpts: paginationOptsValidator,
};
const listInstitutionsReturns = runtimePage(runtimeInstitutionValidator);
const listInstitutionsRead = async (ctx: ActionCtx, args: ObjectType<typeof listInstitutionsArgs> & Of): Promise<RuntimePage<RuntimeInstitution>> =>
  pageOf(
    await readRuntime<RuntimeInstitutionsPage>(ctx, args, "view", (target) =>
      readRuntimeInstitutions(fetch, {
        ...target,
        query: args.query,
        sort: args.sort,
        direction: args.direction,
        ...asked(args.paginationOpts),
      }),
    ),
  );
export const listInstitutions = action({ args: listInstitutionsArgs, returns: listInstitutionsReturns, handler: listInstitutionsRead });
/** The same, for the person the assistant acts for (../evidenceLibraries/assistant.ts). */
export const listInstitutionsFor = internalAction({ args: { ...listInstitutionsArgs, actingAs: v.id("users") }, returns: listInstitutionsReturns, handler: listInstitutionsRead });

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
      action: "view",
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
    const result = await readRuntime(ctx, args, "view", async (target) => {
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
const listPublicationsArgs = {
  libraryId: v.id("evidenceLibraries"),
  query: v.optional(v.string()),
  paginationOpts: paginationOptsValidator,
};
const listPublicationsReturns = runtimePage(reviewedPublicationValidator);
const listPublicationsRead = async (ctx: ActionCtx, args: ObjectType<typeof listPublicationsArgs> & Of): Promise<RuntimePage<RuntimeReviewedPublication>> =>
  pageOf(
    await readRuntime<RuntimeReviewedPublicationsPage>(
      ctx,
      args, "view",
      (target) =>
        readRuntimeReviewedPublications(fetch, {
          ...target,
          query: args.query,
          ...asked(args.paginationOpts),
        }),
    ),
  );
export const listPublications = action({ args: listPublicationsArgs, returns: listPublicationsReturns, handler: listPublicationsRead });
/** The same, for the person the assistant acts for (../evidenceLibraries/assistant.ts). */
export const listPublicationsFor = internalAction({ args: { ...listPublicationsArgs, actingAs: v.id("users") }, returns: listPublicationsReturns, handler: listPublicationsRead });

/** The publication with this key, for the title of a saved choice; null when the library has none. */
const readPublicationArgs = { libraryId: v.id("evidenceLibraries"), key: v.string() };
const readPublicationReturns = v.union(reviewedPublicationValidator, v.null());
const readPublicationRead = async (ctx: ActionCtx, args: ObjectType<typeof readPublicationArgs> & Of): Promise<RuntimeReviewedPublication | null> => {
  const result = await readRuntime<RuntimeReviewedPublicationsPage>(
    ctx,
    args, "view",
    (target) =>
      readRuntimeReviewedPublications(fetch, { ...target, ids: [args.key] }),
  );
  return "reason" in result
    ? null
    : (result.items.find((item) => item.key === args.key) ?? null);
};
export const readPublication = action({ args: readPublicationArgs, returns: readPublicationReturns, handler: readPublicationRead });
/** The same, for the person the assistant acts for (../evidenceLibraries/assistant.ts). */
export const readPublicationFor = internalAction({ args: { ...readPublicationArgs, actingAs: v.id("users") }, returns: readPublicationReturns, handler: readPublicationRead });

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
    const result = await readRuntime(ctx, args, "view", async (target) => ({
      questions: await readRuntimeHomeQuestions(fetch, target),
    }));
    return "reason" in result ? { reason: "not-set-up", questions: [] } : result;
  },
});

/** "Retry import": the library runs the source within seconds. */
const requestSourceRunArgs = { libraryId: v.id("evidenceLibraries"), sourceKey: v.string() };
const requestSourceRunReturns = v.object({ reason: notSetUpValidator });
const requestSourceRunRead = async (ctx: ActionCtx, args: ObjectType<typeof requestSourceRunArgs> & Of): Promise<{ reason?: "not-set-up" }> => {
  const result = await readRuntime(ctx, args, "manage", async (target) => {
    await requestRuntimeSourceRun(fetch, target, args.sourceKey);
    return {};
  });
  return "reason" in result ? { reason: "not-set-up" } : {};
};
export const requestSourceRun = action({ args: requestSourceRunArgs, returns: requestSourceRunReturns, handler: requestSourceRunRead });
/** The same, for the person the assistant acts for (../evidenceLibraries/assistant.ts). */
export const requestSourceRunFor = internalAction({ args: { ...requestSourceRunArgs, actingAs: v.id("users") }, returns: requestSourceRunReturns, handler: requestSourceRunRead });

/** "Try on 200", for the person the assistant or the page acts for: the library grades a sample against a subject and keeps nothing. */
export const trySubjectFor = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), sourceKey: v.string(), subject: v.string(), actingAs: v.id("users") },
  returns: v.union(screeningTrialValidator, v.object({ reason: notSetUpValidator })),
  handler: async (ctx, args) =>
    await readRuntime(ctx, args, "manage", async (target) => {
      const trial = await tryRuntimeScreeningSubject(fetch, target, args.sourceKey, args.subject);
      if (!validate(screeningTrialValidator, trial)) throw new RuntimeReadError("RUNTIME_READ_INVALID", "The library's trial has an unexpected shape");
      return trial as Infer<typeof screeningTrialValidator>;
    }),
});

/** Sends an owner's grading request to the library, as that owner, once the library reports its subject (./../evidenceLibraries/screeningRequests.ts). */
export const sendScreeningGrade = internalAction({
  args: { requestId: v.id("evidenceLibraryScreeningRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const request = await ctx.runQuery(internal.evidenceLibraries.screeningRequests.get, { requestId });
    if (!request) return null;
    try {
      const outcome = await readRuntime(ctx, { libraryId: request.libraryId, actingAs: request.requestedBy }, "manage", (target) =>
        requestRuntimeScreeningGrade(fetch, target, request.sourceKey),
      );
      await ctx.runMutation(internal.evidenceLibraries.screeningRequests.settle, typeof outcome === "string"
        ? { requestId, outcome }
        : { requestId, outcome: "refused", error: "The library isn't running yet." });
    } catch (error) {
      console.error("Screening grade request failed", { requestId, error });
      await ctx.runMutation(internal.evidenceLibraries.screeningRequests.settle, {
        requestId,
        outcome: "refused",
        error: readConvexErrorData(error)?.message ?? (error instanceof Error ? error.message : String(error)),
      });
    }
    return null;
  },
});
