"use node";
/**
 * Calls to an Evidence Library as one of its people (./sourceClient.ts): its records for a job, a
 * person's collections there, and its earlier readers. A refusal or a failure is logged with the
 * library, the call and the reader, and comes back as why, in words the person can act on.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { decrypt } from "../lib/crypto";
import { createError } from "../lib/errors";
import { MAX_AUTHORS } from "../lib/listCaps";
import { screeningPaperInputValidator } from "../screening/validators";
import { paperKey } from "../../lib/papers/paper-ref";
import { librarySourceValidator } from "./validators";
import {
  LIBRARY_BATCH_MAX,
  LIBRARY_RESOLVE_MAX,
  LibrarySourceError,
  readLibraryCollection,
  readLibraryReaders,
  readLibraryRecords,
  readReaderCollections,
  resolveLibrarySource,
  type LibraryRecord,
  type LibraryTarget,
} from "./sourceClient";

/** A running library's address and credential, or why it can't be read. */
async function libraryTarget(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">): Promise<LibraryTarget & { name: string }> {
  const found: { name: string; targetBaseUrl: string; encryptedMachineCredential: string } | null = await ctx.runQuery(internal.evidenceLibraries.sources.target, { libraryId });
  if (!found) throw createError("EVIDENCE_LIBRARY_RUNTIME_ERROR", "This Evidence Library isn't running, so its records can't be read.");
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
  return { name: found.name, baseUrl: found.targetBaseUrl, credential: decrypt(found.encryptedMachineCredential, encryptionKey) };
}

/** The Clerk user ID a library knows a person by. */
async function readerOf(ctx: ActionCtx, userId: Id<"users">): Promise<string> {
  const clerkId: string | null = await ctx.runQuery(internal.evidenceLibraries.sources.readerOf, { userId });
  if (!clerkId) throw createError("UNAUTHENTICATED", "Authentication required");
  return clerkId;
}

/** Runs one call to a library, and turns its refusal or failure into why, logged with who asked and what. */
async function asked<T>(libraryId: Id<"evidenceLibraries">, call: string, reader: string | null, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof LibrarySourceError)) throw error;
    console.warn("[library sources]", { libraryId, call, reader, code: error.code, status: error.status, reason: error.message });
    if (error.code === "private") throw createError("FORBIDDEN", "This collection is private: only its owner and the people it's shared with can read it.");
    if (error.code === "not_found") throw createError("NOT_FOUND", "The library has no such collection.");
    if (error.code === "too_many") throw createError("VALIDATION_ERROR", `A library source gives at most ${LIBRARY_RESOLVE_MAX.toLocaleString("en")} records at once.`);
    throw createError("EVIDENCE_LIBRARY_RUNTIME_ERROR", error.code === "index_changed" ? "The library's search changed while it was read. Try again." : error.message);
  }
}

/** A source's record keys `first` to `last` (from 1), as the person may read them, and how many it holds. */
export const resolve = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), source: librarySourceValidator, first: v.number(), last: v.number() },
  returns: v.object({ keys: v.array(v.string()), total: v.number(), truncated: v.boolean() }),
  handler: async (ctx, { libraryId, userId, source, first, last }): Promise<{ keys: string[]; total: number; truncated: boolean }> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    return await asked(libraryId, "sources/resolve", reader, () => resolveLibrarySource(fetch, target, { reader, source, first, last: Math.min(last, first + LIBRARY_RESOLVE_MAX - 1) }));
  },
});

/** A library record as a job takes a paper: named by its key in the library, with what finds it elsewhere and its first public PDF. */
export function libraryPaper(libraryId: Id<"evidenceLibraries">, baseUrl: string, record: LibraryRecord) {
  const file = record.files[0];
  return {
    paper: paperKey({ source: "library", libraryId, key: record.key }),
    ...(Object.keys(record.crossRefs).length ? { crossRefs: record.crossRefs } : {}),
    title: record.title || record.key,
    ...(record.abstract ? { abstract: record.abstract } : {}),
    authors: record.creators.map((creator) => creator.name).slice(0, MAX_AUTHORS),
    ...(record.year === null ? {} : { publicationYear: record.year }),
    ...(record.crossRefs.doi ? { doi: record.crossRefs.doi } : {}),
    ...(record.venue ? { venue: record.venue } : {}),
    ...(record.itemType ? { workType: record.itemType } : {}),
    ...(file ? { pdfUrl: new URL(`/api/item/${encodeURIComponent(record.key)}/download/${encodeURIComponent(file.attachmentKey)}`, baseUrl).href } : {}),
  };
}

/** Records by key as a job's papers, in the order asked; ones the library no longer shows are left out. */
export const papers = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), keys: v.array(v.string()) },
  returns: v.array(screeningPaperInputValidator),
  handler: async (ctx, { libraryId, keys }): Promise<Array<Infer<typeof screeningPaperInputValidator>>> => {
    if (keys.length > LIBRARY_BATCH_MAX) throw new Error(`Library records are read ${LIBRARY_BATCH_MAX} at a time.`);
    const target = await libraryTarget(ctx, libraryId);
    const records = await asked(libraryId, "records/batch", null, () => readLibraryRecords(fetch, target, keys));
    return records.map((record) => libraryPaper(libraryId, target.baseUrl, record));
  },
});

const collectionValidator = v.object({
  id: v.string(),
  name: v.string(),
  description: v.union(v.string(), v.null()),
  private: v.boolean(),
  count: v.number(),
  access: v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer"), v.null()),
  owner: v.optional(v.union(v.null(), v.object({ name: v.string(), image: v.union(v.string(), v.null()) }))),
});

/** A page of a person's collections in a library: their own, or the ones shared with them. */
export const collections = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), list: v.union(v.literal("own"), v.literal("shared")), page: v.number(), pageSize: v.number() },
  returns: v.object({ rows: v.array(collectionValidator), page: v.number(), pages: v.number(), total: v.number() }),
  handler: async (ctx, { libraryId, userId, list, page, pageSize }): Promise<{ rows: Array<Infer<typeof collectionValidator>>; page: number; pages: number; total: number }> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    return await asked(libraryId, "readers/collections", reader, () => readReaderCollections(fetch, target, reader, { list, page, pageSize }));
  },
});

/** One reader collection as a person may see it. */
export const collection = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), id: v.string() },
  returns: collectionValidator,
  handler: async (ctx, { libraryId, userId, id }): Promise<Infer<typeof collectionValidator>> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    return await asked(libraryId, "collections", reader, () => readLibraryCollection(fetch, target, id, reader));
  },
});

/** Notes every reader a library had before it reported them as they came (./readers.ts `noteReaders`). */
export const backfillReaders = internalAction({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.number(),
  handler: async (ctx, { libraryId }): Promise<number> => {
    const target = await libraryTarget(ctx, libraryId);
    let noted = 0;
    for (let cursor: string | null = null; ; ) {
      const page: { readers: string[]; next: string | null } = await asked(libraryId, "readers", null, () => readLibraryReaders(fetch, target, cursor));
      await ctx.runMutation(internal.evidenceLibraries.readers.noteReaders, { libraryId, clerkUserIds: page.readers });
      noted += page.readers.length;
      if (!page.next) return noted;
      cursor = page.next;
    }
  },
});
