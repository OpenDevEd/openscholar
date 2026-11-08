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
import { LIBRARY_COLLECTION_DESCRIPTION_MAX, LIBRARY_COLLECTION_NAME_MAX, LIBRARY_SOURCE_MAX } from "../../lib/evidence-libraries/source-address";
import { LIBRARY_KEYS_WINDOW } from "../paperSets/libraryKeys";
import { libraryDestinationValidator } from "../screening/validators";
import { LIBRARY_ROWS_MAX, LIBRARY_SOURCE_RECORDS_MAX, handoffRecordsValidator, libraryContentsValidator, librarySourceRowValidator, librarySourceValidator, sourceAddressErrorValidator, addedPapersPageValidator, addedPapersSettingsValidator, paperPreviewsValidator, papersAddedValidator } from "./validators";
import {
  LIBRARY_BATCH_MAX,
  LibrarySourceError,
  changeCollectionRecords,
  createReaderCollection,
  deleteReaderCollection,
  ADDED_PAPERS_MAX,
  addLibraryPapers,
  listLibraryPapers,
  removeLibraryPaper,
  setLibraryPaperSettings,
  matchLibraryRecords,
  previewLibraryPapers,
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

/** A running library's address and credential; null for one that isn't running. */
async function runningTarget(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">): Promise<(LibraryTarget & { name: string }) | null> {
  const found: { name: string; targetBaseUrl: string; encryptedMachineCredential: string } | null = await ctx.runQuery(internal.evidenceLibraries.sources.target, { libraryId });
  if (!found) return null;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
  return { name: found.name, baseUrl: found.targetBaseUrl, credential: decrypt(found.encryptedMachineCredential, encryptionKey) };
}

/** A running library's address and credential, or why it can't be read. */
async function libraryTarget(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">): Promise<LibraryTarget & { name: string }> {
  const target = await runningTarget(ctx, libraryId);
  if (!target) throw createError("EVIDENCE_LIBRARY_RUNTIME_ERROR", "This Evidence Community isn't running, so its records can't be read.");
  return target;
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
    if (error.code === "not_found") throw createError("NOT_FOUND", "The community has no such collection.");
    if (error.code === "too_many") throw createError("VALIDATION_ERROR", `A community source gives at most ${LIBRARY_SOURCE_MAX.toLocaleString("en")} records at once.`);
    if (error.code === "role") throw createError("FORBIDDEN", "You can only view this collection: its owner can let you edit it.");
    if (error.code === "not_reader") throw createError("FORBIDDEN", "Sign in to this community once to keep collections there.");
    if (error.code === "changed") throw createError("CONFLICT", error.message);
    throw createError("EVIDENCE_LIBRARY_RUNTIME_ERROR", error.code === "index_changed" ? "The community's search changed while it was read. Try again." : error.message);
  }
}

/** A window of a source's record keys `first` to `last` (from 1), at most LIBRARY_KEYS_WINDOW, as the person may read them, and how many it holds. */
export const resolve = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), source: librarySourceValidator, first: v.number(), last: v.number() },
  returns: v.object({ keys: v.array(v.string()), total: v.number(), truncated: v.boolean() }),
  handler: async (ctx, { libraryId, userId, source, first, last }): Promise<{ keys: string[]; total: number; truncated: boolean }> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    return await asked(libraryId, "sources/resolve", reader, () => resolveLibrarySource(fetch, target, { reader, source, first, last: Math.min(last, first + LIBRARY_KEYS_WINDOW - 1) }));
  },
});

/** A library record as a job takes a paper: named by its key in the library, with what finds it elsewhere and its first public PDF. */
export function libraryPaper(libraryId: Id<"evidenceLibraries">, baseUrl: string, record: LibraryRecord) {
  const file = record.files.find((one) => one.contentType === "application/pdf");
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
    if (keys.length > LIBRARY_BATCH_MAX) throw new Error(`Community records are read ${LIBRARY_BATCH_MAX} at a time.`);
    const target = await libraryTarget(ctx, libraryId);
    const records = await asked(libraryId, "records/batch", null, () => readLibraryRecords(fetch, target, keys));
    return records.map((record) => libraryPaper(libraryId, target.baseUrl, record));
  },
});

/** Records `first` to `last` (from 1) of a source as the person may read them, as a job takes them, in the source's order, and how many it holds. */
export const page = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), source: librarySourceValidator, first: v.number(), last: v.number() },
  returns: v.object({ total: v.number(), papers: v.array(screeningPaperInputValidator) }),
  handler: async (ctx, { libraryId, userId, source, first, last }): Promise<{ total: number; papers: Array<Infer<typeof screeningPaperInputValidator>> }> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    const found = await asked(libraryId, "sources/resolve", reader, () => resolveLibrarySource(fetch, target, { reader, source, first, last: Math.min(last, first + LIBRARY_BATCH_MAX - 1) }));
    const records = found.keys.length ? await asked(libraryId, "records/batch", reader, () => readLibraryRecords(fetch, target, found.keys)) : [];
    return { total: found.total, papers: records.map((record) => libraryPaper(libraryId, target.baseUrl, record)) };
  },
});

/** Records by key as the person may read them, in the order given, as a hand-off's page lists them. */
export const listed = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), keys: v.array(v.string()) },
  returns: handoffRecordsValidator,
  handler: async (ctx, { libraryId, userId, keys }): Promise<Infer<typeof handoffRecordsValidator>> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    const found = await asked(libraryId, "sources/resolve", reader, () => resolveLibrarySource(fetch, target, { reader, source: { records: keys.slice(0, LIBRARY_SOURCE_RECORDS_MAX) }, first: 1, last: LIBRARY_SOURCE_RECORDS_MAX }));
    const records: LibraryRecord[] = [];
    for (let at = 0; at < found.keys.length; at += LIBRARY_BATCH_MAX) records.push(...(await asked(libraryId, "records/batch", reader, () => readLibraryRecords(fetch, target, found.keys.slice(at, at + LIBRARY_BATCH_MAX)))));
    return records.map((record) => ({ key: record.key, title: record.title || record.key, authors: record.creators.map((creator) => creator.name).slice(0, MAX_AUTHORS), year: record.year }));
  },
});

const libraryCollectionSaveTo = v.union(
  v.object({ kind: v.literal("libraryCollection"), libraryId: v.id("evidenceLibraries"), collection: v.string() }),
  v.object({ kind: v.literal("newLibraryCollection"), libraryId: v.id("evidenceLibraries"), name: v.string(), private: v.boolean(), requestId: v.string() }),
);

/**
 * The library collection a screening's included papers go to: one the person owns or edits there, or a new one of
 * theirs, made once for its `requestId` however often the start is tried.
 */
export const destination = internalAction({
  args: { userId: v.id("users"), saveTo: libraryCollectionSaveTo },
  returns: libraryDestinationValidator,
  handler: async (ctx, { userId, saveTo }): Promise<Infer<typeof libraryDestinationValidator>> => {
    const target = await libraryTarget(ctx, saveTo.libraryId);
    const reader = await readerOf(ctx, userId);
    if (saveTo.kind === "newLibraryCollection") {
      const made = await makeCollection(saveTo.libraryId, target, reader, saveTo);
      return { libraryId: saveTo.libraryId, collection: made.id, name: made.name };
    }
    return { libraryId: saveTo.libraryId, ...(await editableCollection(saveTo.libraryId, target, reader, saveTo.collection)) };
  },
});

/** A collection made for the person, once for its `requestId` however often it is asked for. */
async function makeCollection(libraryId: Id<"evidenceLibraries">, target: LibraryTarget, reader: string, collection: { name: string; description?: string; private: boolean; requestId: string }) {
  const name = collection.name.trim();
  if (!name) throw createError("VALIDATION_ERROR", "Name the new collection.");
  if (name.length > LIBRARY_COLLECTION_NAME_MAX) throw createError("VALIDATION_ERROR", `A community collection's name is at most ${LIBRARY_COLLECTION_NAME_MAX} characters.`);
  const description = collection.description?.trim();
  if (description && description.length > LIBRARY_COLLECTION_DESCRIPTION_MAX) throw createError("VALIDATION_ERROR", `A community collection's description is at most ${LIBRARY_COLLECTION_DESCRIPTION_MAX} characters.`);
  return await asked(libraryId, "readers/collections:create", reader, () => createReaderCollection(fetch, target, reader, { name, ...(description ? { description } : {}), private: collection.private, requestId: collection.requestId }));
}

/** A collection of the library's the person owns or edits there, by its ID and name; one they only view is refused. */
async function editableCollection(libraryId: Id<"evidenceLibraries">, target: LibraryTarget, reader: string, id: string) {
  const found = await asked(libraryId, "collections", reader, () => readLibraryCollection(fetch, target, id, reader));
  if (found.access !== "owner" && found.access !== "editor") throw createError("FORBIDDEN", `You can only view ${found.name}: its owner can let you edit it.`);
  return { collection: found.id, name: found.name };
}

/** The name of a library collection a screening takes papers out of; one the person may only view is refused. */
export const requireEditable = internalAction({
  args: { userId: v.id("users"), libraryId: v.id("evidenceLibraries"), collection: v.string() },
  returns: v.string(),
  handler: async (ctx, { userId, libraryId, collection }): Promise<string> => (await editableCollection(libraryId, await libraryTarget(ctx, libraryId), await readerOf(ctx, userId), collection)).name,
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

/** A collection made for a person in a library, as their profile there makes one. */
export const createCollection = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), name: v.string(), description: v.optional(v.string()), private: v.boolean(), requestId: v.string() },
  returns: collectionValidator,
  handler: async (ctx, { libraryId, userId, ...collection }): Promise<Infer<typeof collectionValidator>> => await makeCollection(libraryId, await libraryTarget(ctx, libraryId), await readerOf(ctx, userId), collection),
});

/** Puts records into a collection the person owns or edits, or takes them out: the keys that changed, and the records the library doesn't show. */
export const changeRecords = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), collection: v.string(), keys: v.array(v.string()), change: v.union(v.literal("add"), v.literal("remove")) },
  returns: v.object({ count: v.number(), changed: v.array(v.string()), missing: v.array(v.string()) }),
  handler: async (ctx, { libraryId, userId, collection, keys, change }): Promise<{ count: number; changed: string[]; missing: string[] }> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    return await asked(libraryId, `readers/collections/records:${change}`, reader, () => changeCollectionRecords(fetch, target, reader, collection, keys, change));
  },
});

/** Deletes a collection the person owns, once it is as `expect` says when given. */
export const deleteCollection = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), collection: v.string(), expect: v.optional(v.object({ name: v.string(), description: v.union(v.string(), v.null()), private: v.boolean(), records: v.number(), members: v.number() })) },
  returns: v.null(),
  handler: async (ctx, { libraryId, userId, collection, expect }): Promise<null> => {
    const target = await libraryTarget(ctx, libraryId);
    const reader = await readerOf(ctx, userId);
    await asked(libraryId, "readers/collections:delete", reader, () => deleteReaderCollection(fetch, target, reader, collection, expect));
    return null;
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
      // A search, collection or library that holds nothing is said so, not offered as a source; a record that isn't there is `notFound`.
      if (!found.total && !("records" in source)) return { error: "empty" };
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
        // Records a library handed over are named after it (useRowLabel); one record, after its title.
        if (found.total && source.records.length > 1) return { row: { libraryId, source, what: "records", label: target.name, records: found.total } };
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

/** How often a library that didn't answer is asked again for a job's writes, and how long it waits between. */
const WRITE_ATTEMPTS = 5;
const WRITE_RETRY_MS = 60_000;
/** How long writes queued while a batch was out wait for others, so they go in one call. */
const WRITE_GATHER_MS = 5_000;
type Problem = "role" | "notFound" | "unreadable";

/**
 * Writes a batch of a screening's queued library changes (./writes.ts), as the person who started the job: a paper
 * that is a record of that library goes by its key, any other by the record the library holds for its OpenAlex ID or
 * DOI, and one it holds none of is `missing`. A library that didn't answer is asked again a few times.
 */
export const flushWrites = internalAction({
  args: { job: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, { job }) => {
    const { userId, destination, rows, gone, more } = await ctx.runQuery(internal.evidenceLibraries.writes.batch, { job });
    const reader: string | null = userId ? await ctx.runQuery(internal.evidenceLibraries.sources.readerOf, { userId }) : null;
    // Writes whose job or paper is gone go with nothing written, and so do all of a job whose account can no longer act:
    // nothing is written as someone suspended or deleted since.
    if (!rows.length || !reader) {
      const settled = [...gone, ...(reader ? [] : rows.map(({ id, result }) => ({ id, result })))];
      const waiting = settled.length > 0 && (await ctx.runMutation(internal.evidenceLibraries.writes.written, { job, rows: settled }));
      if (waiting) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.sourceActions.flushWrites, { job });
      return null;
    }
    const done: Array<{ id: Id<"libraryWrites">; result: Id<"screeningResults">; write?: "added" | "missing" }> = [...gone];
    const retried: Array<Id<"libraryWrites">> = [];
    let removed = 0;
    let problem: Problem | undefined;
    let pruneProblem: Problem | undefined;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) groups.set(`${row.libraryId}|${row.collection}|${row.change}|${row.prune}`, [...(groups.get(`${row.libraryId}|${row.collection}|${row.change}|${row.prune}`) ?? []), row]);
    for (const group of groups.values()) {
      const { libraryId, collection, change, prune } = group[0]!;
      // Only the collection its included papers go to says which of them it took.
      const toDestination = change === "add" && !prune && destination?.libraryId === libraryId && destination.collection === collection;
      try {
        // A library taken down since has no collection to write to.
        const target = await runningTarget(ctx, libraryId);
        if (!target) throw new LibrarySourceError("not_found", "This Evidence Community isn't running any more.");
        const keyOf = new Map<string, string>();
        for (const row of group) if (row.ref.source === "library" && row.ref.libraryId === libraryId) keyOf.set(row.paperKey, row.ref.key);
        const asking = group.filter((row) => !keyOf.has(row.paperKey) && (row.crossRefs?.openalexId || row.crossRefs?.doi));
        if (asking.length) {
          const matches = await matchLibraryRecords(fetch, target, reader, asking.map((row) => ({ ...(row.crossRefs?.openalexId ? { openalexId: row.crossRefs.openalexId } : {}), ...(row.crossRefs?.doi ? { doi: row.crossRefs.doi } : {}) })));
          for (const { at, key } of matches) if (asking[at]) keyOf.set(asking[at].paperKey, key);
        }
        const keys = [...new Set(group.flatMap((row) => keyOf.get(row.paperKey) ?? []))];
        const changed = keys.length ? await changeCollectionRecords(fetch, target, reader, collection, keys, change) : { changed: [] as string[], missing: [] as string[] };
        // A pruned paper counts as removed once it has left, and no longer once it's back.
        if (prune) removed += (change === "remove" ? 1 : -1) * group.filter((row) => changed.changed.includes(keyOf.get(row.paperKey) ?? "")).length;
        for (const row of group) {
          const key = keyOf.get(row.paperKey);
          done.push({ id: row.id, result: row.result, ...(toDestination ? { write: key && !changed.missing.includes(key) ? ("added" as const) : ("missing" as const) } : {}) });
        }
      } catch (error) {
        if (!(error instanceof LibrarySourceError)) throw error;
        console.warn("[library sources]", { libraryId, call: `writes:${change}`, reader, job, code: error.code, status: error.status, reason: error.message });
        // A library that didn't answer is asked again later, each write up to WRITE_ATTEMPTS times; the other groups go on.
        if (error.code === "unavailable" && Math.max(...group.map((row) => row.attempts)) + 1 < WRITE_ATTEMPTS) {
          retried.push(...group.map((row) => row.id));
          continue;
        }
        const why: Problem = error.code === "role" || error.code === "not_reader" || error.code === "private" ? "role" : error.code === "not_found" ? "notFound" : "unreadable";
        if (prune) pruneProblem = why;
        else problem = why;
        for (const row of group) done.push({ id: row.id, result: row.result });
      }
    }
    const waiting = await ctx.runMutation(internal.evidenceLibraries.writes.written, { job, rows: done, removed, retried, ...(problem ? { problem } : {}), ...(pruneProblem ? { pruneProblem } : {}) });
    // Papers that moved while this batch was out wait for the next, which nothing else would start; one asked again waits a minute.
    if (more || waiting) await ctx.scheduler.runAfter(retried.length ? WRITE_RETRY_MS : more ? 0 : WRITE_GATHER_MS, internal.evidenceLibraries.sourceActions.flushWrites, { job });
    return null;
  },
});

/**
 * Asks a running community how many public records it holds, and keeps the answer for the directory
 * (./directory.ts). One that isn't running, or doesn't answer, keeps its last count until the next ask.
 */
export const refreshRecords = internalAction({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, { libraryId }) => {
    const target = await runningTarget(ctx, libraryId).catch(() => null);
    if (!target) return null;
    let overview: Awaited<ReturnType<typeof readLibraryOverview>>;
    try {
      overview = await readLibraryOverview(fetch, target, LIST_TIMEOUT_MS);
    } catch (error) {
      console.warn("[community directory] the record count couldn't be read", { libraryId, reason: error instanceof Error ? error.message : String(error) });
      // Only a site that didn't answer, or answered with a server error, leaves the directory: one that refused or
      // answered oddly is still there for its visitors.
      if (error instanceof LibrarySourceError && error.code === "unavailable") await ctx.runMutation(internal.evidenceLibraries.directory.noteUnreachable, { libraryId });
      return null;
    }
    await ctx.runMutation(internal.evidenceLibraries.directory.setRecords, { libraryId, records: overview.records, ...(overview.countries ? { countries: overview.countries.map((country) => country.code) } : {}) });
    return null;
  },
});

// Papers added to a community by DOI or OpenAlex ID (OS-29, OpenDevEd/openalex-count#1122).

const paperReferenceValidator = v.object({ openalexId: v.optional(v.union(v.string(), v.null())), doi: v.optional(v.union(v.string(), v.null())) });
const teamRoleValidator = v.union(v.literal("owner"), v.literal("editor"), v.literal("creator"));

/** What adding papers to a running community would find, saving nothing. */
export const previewPapers = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), papers: v.array(paperReferenceValidator) },
  returns: paperPreviewsValidator,
  handler: async (ctx, { libraryId, papers }) => {
    if (papers.length > ADDED_PAPERS_MAX) throw createError("VALIDATION_ERROR", `Look up at most ${ADDED_PAPERS_MAX} papers at once.`);
    const target = await libraryTarget(ctx, libraryId);
    return await asked(libraryId, "papers/preview", null, () => previewLibraryPapers(fetch, target, papers));
  },
});

/** Adds papers to a running community as the person, with their role there, published or to its review queue. */
export const addPapers = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    userId: v.id("users"),
    role: teamRoleValidator,
    name: v.union(v.string(), v.null()),
    requestId: v.string(),
    publish: v.boolean(),
    papers: v.array(paperReferenceValidator),
  },
  returns: papersAddedValidator,
  handler: async (ctx, { libraryId, userId, role, name, requestId, publish, papers }) => {
    if (papers.length > ADDED_PAPERS_MAX) throw createError("VALIDATION_ERROR", `Add at most ${ADDED_PAPERS_MAX} papers at once.`);
    const target = await libraryTarget(ctx, libraryId);
    const clerkUserId = await readerOf(ctx, userId);
    return await asked(libraryId, "papers/add", clerkUserId, () => addLibraryPapers(fetch, target, { requestId, publish, actor: { clerkUserId, name, role }, papers }));
  },
});

/** A running community's added papers, newest first, a page at a time, each marked when the person sent it. */
export const listPapers = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), cursor: v.union(v.string(), v.null()), limit: v.number() },
  returns: addedPapersPageValidator,
  handler: async (ctx, { libraryId, userId, cursor, limit }) => {
    const target = await libraryTarget(ctx, libraryId);
    const clerkUserId = await readerOf(ctx, userId);
    const page = await asked(libraryId, "papers/list", clerkUserId, () => listLibraryPapers(fetch, target, { cursor, limit: Math.min(100, Math.max(1, Math.floor(limit))) }));
    // Who sent each paper stays in the community: the list says only whether it was this person.
    return { ...page, papers: page.papers.map(({ addedBy, ...paper }) => ({ ...paper, mine: addedBy === clerkUserId })) };
  },
});

/** Pauses or resumes a running community's Added papers source, or turns its PDFs on or off. */
export const setPaperSettings = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), enabled: v.optional(v.boolean()), downloadPdfs: v.optional(v.boolean()) },
  returns: addedPapersSettingsValidator,
  handler: async (ctx, { libraryId, ...change }) => {
    const target = await libraryTarget(ctx, libraryId);
    return await asked(libraryId, "papers/settings", null, () => setLibraryPaperSettings(fetch, target, change));
  },
});

/** Takes an added paper off a running community as the person, with their role there. */
export const removePaper = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), userId: v.id("users"), role: teamRoleValidator, name: v.union(v.string(), v.null()), itemKey: v.string() },
  returns: v.union(v.literal("withdrawn"), v.literal("removed")),
  handler: async (ctx, { libraryId, userId, role, name, itemKey }) => {
    const target = await libraryTarget(ctx, libraryId);
    const clerkUserId = await readerOf(ctx, userId);
    return await asked(libraryId, "papers/remove", clerkUserId, () => removeLibraryPaper(fetch, target, itemKey, { clerkUserId, name, role }));
  },
});
