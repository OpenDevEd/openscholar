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
import { LIBRARY_SOURCE_MAX } from "../../lib/evidence-libraries/source-address";
import { LIBRARY_ROWS_MAX, libraryContentsValidator, librarySourceRowValidator, librarySourceValidator, sourceAddressErrorValidator } from "./validators";
import {
  LIBRARY_BATCH_MAX,
  LibrarySourceError,
  readLibraryCollection,
  readLibraryOverview,
  readLibraryReaders,
  readLibraryRecords,
  readReaderCollections,
  resolveLibrarySource,
  type LibraryCollection,
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
    if (error.code === "too_many") throw createError("VALIDATION_ERROR", `A library source gives at most ${LIBRARY_SOURCE_MAX.toLocaleString("en")} records at once.`);
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
    return await asked(libraryId, "sources/resolve", reader, () => resolveLibrarySource(fetch, target, { reader, source, first, last: Math.min(last, first + LIBRARY_SOURCE_MAX - 1) }));
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

type Row = Infer<typeof librarySourceRowValidator>;
type Contents = Infer<typeof libraryContentsValidator>;

/** How long a library's list waits for it: a form waits on the list. */
const LIST_TIMEOUT_MS = 6_000;
/** A person's own or shared collections in a library read at once. */
// ponytail: one page of 100 each; a person with more lists the first 100, and pastes the address of any other.
const COLLECTIONS_LISTED = 100;

/** A reader's collection as a row: theirs, shared with them, or someone else's they may read. */
const readerRow = (libraryId: Id<"evidenceLibraries">, collection: LibraryCollection, what: "yours" | "shared" | "other"): Row => ({
  libraryId,
  source: { readerCollection: collection.id },
  what,
  label: collection.name,
  records: collection.count,
  private: collection.private,
  ...(collection.access ? { access: collection.access } : {}),
  ...(collection.owner && what !== "yours" ? { owner: collection.owner } : {}),
});

/** A person's own or shared collections in a library; none where the library keeps no reader accounts. */
async function readerCollectionsOf(target: LibraryTarget, reader: string, list: "own" | "shared") {
  try {
    return (await readReaderCollections(fetch, target, reader, { list, page: 1, pageSize: COLLECTIONS_LISTED }, LIST_TIMEOUT_MS)).rows;
  } catch (error) {
    if (error instanceof LibrarySourceError && error.code === "private") return [];
    throw error;
  }
}

/** What one library lists for a person, or why it can't: logged with the library and the reader. */
async function contentsOf(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">, reader: string): Promise<Contents> {
  try {
    const target = await libraryTarget(ctx, libraryId);
    const [overview, own, shared] = await Promise.all([readLibraryOverview(fetch, target, LIST_TIMEOUT_MS), readerCollectionsOf(target, reader, "own"), readerCollectionsOf(target, reader, "shared")]);
    const names = new Map(overview.collections.map((collection) => [collection.key, collection.name]));
    // ponytail: a library with more collections than the list holds lists the first by name; any other is reached by its address.
    const rows: Row[] = [
      ...(overview.records ? [{ libraryId, source: { library: true as const }, what: "all" as const, label: target.name, records: overview.records }] : []),
      ...own.map((collection) => readerRow(libraryId, collection, "yours")),
      ...shared.map((collection) => readerRow(libraryId, collection, "shared")),
      ...overview.collections.map((collection): Row => {
        const parent = collection.parent ? names.get(collection.parent) : undefined;
        return { libraryId, source: { libraryCollection: collection.key }, what: "library", label: collection.name, records: collection.records, ...(parent ? { parent } : {}) };
      }),
    ].slice(0, LIBRARY_ROWS_MAX);
    return { libraryId, rows, problem: null };
  } catch (error) {
    const code = error instanceof LibrarySourceError ? error.code : null;
    console.warn("[library sources]", { libraryId, call: "list", reader, code, status: error instanceof LibrarySourceError ? error.status : undefined, reason: error instanceof Error ? error.message : String(error) });
    return { libraryId, rows: null, problem: code === "outdated" ? "outdated" : "unreadable" };
  }
}

/** Every source each library lists for a person, each library asked at once; a library that fails says why, and the others list. */
export const sources = internalAction({
  args: { userId: v.id("users"), libraryIds: v.array(v.id("evidenceLibraries")) },
  returns: v.array(libraryContentsValidator),
  handler: async (ctx, { userId, libraryIds }): Promise<Contents[]> => {
    const reader = await readerOf(ctx, userId);
    return await Promise.all(libraryIds.map((libraryId) => contentsOf(ctx, libraryId, reader)));
  },
});

/** A source as a row, as the person may read it, or why it is none. */
export const describe = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), source: librarySourceValidator },
  returns: v.union(v.object({ row: librarySourceRowValidator }), v.object({ error: sourceAddressErrorValidator })),
  handler: async (ctx, { libraryId, userId, source }): Promise<{ row: Row } | { error: Infer<typeof sourceAddressErrorValidator> }> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    try {
      // What the library finds for the source now, as the person may read it: a library too old to be read here says so.
      const found = await resolveLibrarySource(fetch, target, { reader, source, first: 1, last: 1 });
      if ("library" in source || "libraryCollection" in source) {
        if ("library" in source) return { row: { libraryId, source, what: "all", label: target.name, records: found.total } };
        const { collections } = await readLibraryOverview(fetch, target);
        const collection = collections.find((one) => one.key === source.libraryCollection);
        if (!collection) return { error: "notFound" };
        const parent = collections.find((one) => one.key === collection.parent)?.name;
        return { row: { libraryId, source, what: "library", label: collection.name, records: found.total, ...(parent ? { parent } : {}) } };
      }
      // A reader's collection the person may read, theirs or not: the library refuses a private one they aren't in.
      const collection = "readerCollection" in source && source.readerCollection ? await readLibraryCollection(fetch, target, source.readerCollection, reader) : null;
      if (collection && !("search" in source)) return { row: { ...readerRow(libraryId, collection, collection.access === "owner" ? "yours" : collection.access ? "shared" : "other"), records: found.total } };
      if ("records" in source) {
        const [record] = found.total ? await readLibraryRecords(fetch, target, found.keys) : [];
        return record ? { row: { libraryId, source, what: "records", label: record.title || record.key, records: found.total } } : { error: "notFound" };
      }
      const words = "search" in source ? (new URLSearchParams(source.search).get("search") ?? "") : "";
      return { row: { libraryId, source, what: "search", label: words, records: found.total, ...(collection ? { parent: collection.name } : {}) } };
    } catch (error) {
      if (!(error instanceof LibrarySourceError)) throw error;
      console.warn("[library sources]", { libraryId, call: "describe", reader, code: error.code, status: error.status, reason: error.message });
      return { error: error.code === "private" ? "private" : error.code === "not_found" ? "notFound" : error.code === "outdated" ? "outdated" : "unreadable" };
    }
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
