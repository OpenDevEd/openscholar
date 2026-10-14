// What OpenScholar reads of an Evidence Library as one of its people (plans/evidence-library-sources):
// a person's collections there, a source turned into record keys, and records by key. Every call
// carries the library's machine credential and the contract version; the library decides what the
// person may read. A library on an older runtime answers 404 to these paths.
import { z } from "zod";
import { publicLibraryHeaders } from "../../lib/evidence-libraries/library-shield";
import { LIBRARY_SOURCE_MAX, type LibrarySource } from "../../lib/evidence-libraries/source-address";

export const LIBRARY_CONTRACT = "1";
/** Most records one batch reads. */
export const LIBRARY_BATCH_MAX = 500;
const TIMEOUT_MS = 30_000;
/** Times a source is asked for while the library's search keeps changing under it. */
const RESOLVE_ATTEMPTS = 3;

export type LibraryTarget = { baseUrl: string; credential: string };

/** Why a library read failed, in words a person can act on. */
export class LibrarySourceError extends Error {
  constructor(
    readonly code: "outdated" | "refused" | "private" | "not_found" | "too_many" | "index_changed" | "invalid" | "unavailable" | "role" | "not_reader" | "changed",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LibrarySourceError";
  }
}

const refusalSchema = z.object({ error: z.string(), message: z.string().optional() });

/** One call to the library; a refusal or a failure throws, with why. */
async function call<T>(fetchImpl: typeof fetch, target: LibraryTarget, path: string, schema: z.ZodType<T>, { body, params, timeoutMs = TIMEOUT_MS, method = body === undefined ? "GET" : "POST" }: { body?: unknown; params?: Record<string, string | undefined>; timeoutMs?: number; method?: "GET" | "POST" | "DELETE" } = {}): Promise<T> {
  const url = new URL(path, target.baseUrl);
  for (const [key, value] of Object.entries(params ?? {})) if (value) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${target.credential}`, "OpenScholar-Contract": LIBRARY_CONTRACT, ...publicLibraryHeaders("application/json"), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new LibrarySourceError("unavailable", `The library did not answer: ${error instanceof Error ? error.message : String(error)}`);
  }
  const answer: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = schema.safeParse(answer);
    if (!parsed.success) throw new LibrarySourceError("invalid", "The library answered in a shape OpenScholar doesn't read.", response.status);
    return parsed.data;
  }
  const refusal = refusalSchema.safeParse(answer);
  // A runtime from before these calls has no such path: it answers its own page, not a refusal.
  if (response.status === 404 && !refusal.success) throw new LibrarySourceError("outdated", "This library needs an update to be used here.", 404);
  if (response.status === 401) throw new LibrarySourceError("refused", "The library refused OpenScholar's credential.", 401);
  const code = refusal.success ? refusal.data.error : "";
  const message = refusal.success ? (refusal.data.message ?? code) : `The library answered ${response.status}.`;
  if (code === "private" || code === "reader_accounts_off") throw new LibrarySourceError("private", message, response.status);
  if (code === "not_found") throw new LibrarySourceError("not_found", message, response.status);
  if (code === "too_many") throw new LibrarySourceError("too_many", message, response.status);
  if (code === "index_changed") throw new LibrarySourceError("index_changed", message, response.status);
  if (code === "contract") throw new LibrarySourceError("outdated", "This library needs an update to be used here.", response.status);
  if (code === "role" || code === "not_reader" || code === "changed") throw new LibrarySourceError(code, message, response.status);
  throw new LibrarySourceError(response.status >= 500 ? "unavailable" : "invalid", message, response.status);
}

const resolvedSchema = z.object({ keys: z.array(z.string()).max(LIBRARY_SOURCE_MAX), total: z.number().int().min(0), truncated: z.boolean() });

/** A source's record keys `first` to `last` (from 1) as `reader` may read them, in the library's order, with how many it holds. */
export async function resolveLibrarySource(fetchImpl: typeof fetch, target: LibraryTarget, request: { reader: string | null; source: LibrarySource; first: number; last: number }) {
  // A library whose search changed while it read asks to be asked again: a sync in progress, which passes.
  for (let attempt = 1; ; attempt++) {
    try {
      return await call(fetchImpl, target, "/api/v1/openscholar/sources/resolve", resolvedSchema, { body: request });
    } catch (error) {
      if (!(error instanceof LibrarySourceError && error.code === "index_changed" && attempt < RESOLVE_ATTEMPTS)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
}

const recordSchema = z.object({
  key: z.string(),
  revision: z.number(),
  itemType: z.string(),
  title: z.string(),
  abstract: z.string().nullable(),
  creators: z.array(z.object({ name: z.string() })),
  year: z.number().nullable(),
  venue: z.string().nullable(),
  url: z.string().nullable(),
  crossRefs: z.object({ openalexId: z.string().optional(), doi: z.string().optional() }),
  files: z.array(z.object({ attachmentKey: z.string(), filename: z.string().nullable(), contentType: z.string() })),
});
export type LibraryRecord = z.infer<typeof recordSchema>;
const recordsSchema = z.object({ records: z.array(recordSchema).max(LIBRARY_BATCH_MAX), unread: z.array(z.string()).max(LIBRARY_BATCH_MAX) });

/** Records by key, every one asked for that is public there; a batch the library cut short says which are left. */
export async function readLibraryRecords(fetchImpl: typeof fetch, target: LibraryTarget, keys: string[]): Promise<LibraryRecord[]> {
  const records: LibraryRecord[] = [];
  for (let left = keys.slice(0, LIBRARY_BATCH_MAX); left.length; ) {
    const read = await call(fetchImpl, target, "/api/v1/openscholar/records/batch", recordsSchema, { body: { keys: left } });
    records.push(...read.records);
    // A library that reads none of what is left would never end.
    if (!read.records.length) break;
    left = read.unread;
  }
  return records;
}

const personSchema = z.object({ name: z.string(), image: z.string().nullable() }).nullable();
const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  count: z.number(),
  access: z.enum(["owner", "editor", "viewer"]).nullable(),
  owner: personSchema.optional(),
});
export type LibraryCollection = z.infer<typeof collectionSchema>;
const collectionsSchema = z.object({ rows: z.array(collectionSchema), page: z.number(), pages: z.number(), total: z.number() });

/** A page of a person's collections in the library: their own, or the ones shared with them. */
export async function readReaderCollections(fetchImpl: typeof fetch, target: LibraryTarget, clerkUserId: string, { list, page, pageSize }: { list: "own" | "shared"; page: number; pageSize: number }, timeoutMs?: number) {
  return await call(fetchImpl, target, `/api/v1/openscholar/readers/${encodeURIComponent(clerkUserId)}/collections`, collectionsSchema, { params: { list, page: String(page), pageSize: String(pageSize) }, timeoutMs });
}

/** One collection as `reader` may see it. */
export async function readLibraryCollection(fetchImpl: typeof fetch, target: LibraryTarget, id: string, reader: string | null) {
  return await call(fetchImpl, target, `/api/v1/openscholar/collections/${encodeURIComponent(id)}`, collectionSchema, { params: { reader: reader ?? undefined } });
}

const overviewSchema = z.object({
  records: z.number().int().min(0),
  collections: z.array(z.object({ key: z.string(), name: z.string(), parent: z.string().nullable(), records: z.number().int().min(0) })),
});

/** How many public records the library holds, and its own collections by name, each with the records resolving it reads. */
export async function readLibraryOverview(fetchImpl: typeof fetch, target: LibraryTarget, timeoutMs?: number) {
  const overview = await call(fetchImpl, target, "/api/v1/openscholar/library", overviewSchema, { timeoutMs });
  return { ...overview, collections: [...overview.collections].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** A page of the OpenScholar accounts that signed in to the library. */
export async function readLibraryReaders(fetchImpl: typeof fetch, target: LibraryTarget, cursor: string | null) {
  return await call(fetchImpl, target, "/api/v1/openscholar/readers", z.object({ readers: z.array(z.string()), next: z.string().nullable() }), { params: { cursor: cursor ?? undefined } });
}

/** A collection made for a person, as their profile makes one; the same `requestId` answers the one it made before. */
export async function createReaderCollection(fetchImpl: typeof fetch, target: LibraryTarget, clerkUserId: string, collection: { name: string; description?: string; private: boolean; requestId: string }) {
  return (await call(fetchImpl, target, `/api/v1/openscholar/readers/${encodeURIComponent(clerkUserId)}/collections`, z.object({ collection: collectionSchema }), { body: collection })).collection;
}

/** Most records one change to a collection takes. */
export const LIBRARY_CHANGE_MAX = 500;

/** Puts records into a collection the person owns or edits, or takes them out: `changed` are the keys that went in or came out, `missing` records the library doesn't show. */
export async function changeCollectionRecords(fetchImpl: typeof fetch, target: LibraryTarget, clerkUserId: string, collectionId: string, keys: string[], change: "add" | "remove") {
  const path = `/api/v1/openscholar/readers/${encodeURIComponent(clerkUserId)}/collections/${encodeURIComponent(collectionId)}/records`;
  return await call(fetchImpl, target, path, z.object({ count: z.number(), changed: z.array(z.string()).max(LIBRARY_CHANGE_MAX), missing: z.array(z.string()).max(LIBRARY_CHANGE_MAX) }), { body: { keys }, method: change === "add" ? "POST" : "DELETE" });
}

/**
 * Deletes a collection the person owns, as their profile does: its records stay in their bookmarks. With `expect`, only
 * while it is still so (everything its owner can change); one changed since is refused (`changed`) and stays.
 */
export async function deleteReaderCollection(fetchImpl: typeof fetch, target: LibraryTarget, clerkUserId: string, collectionId: string, expect?: { name: string; description: string | null; private: boolean; records: number; members: number }) {
  const path = `/api/v1/openscholar/readers/${encodeURIComponent(clerkUserId)}/collections/${encodeURIComponent(collectionId)}`;
  await call(fetchImpl, target, path, z.object({ deleted: z.literal(true) }), { body: expect ? { expect } : {}, method: "DELETE" });
}

/** The records the library holds for papers by their OpenAlex ID or DOI: each match names the paper by its place (`at`). */
export async function matchLibraryRecords(fetchImpl: typeof fetch, target: LibraryTarget, reader: string | null, papers: Array<{ openalexId?: string; doi?: string }>) {
  return (await call(fetchImpl, target, "/api/v1/openscholar/records/match", z.object({ matches: z.array(z.object({ at: z.number().int(), key: z.string() })).max(LIBRARY_CHANGE_MAX) }), { body: { reader, papers } })).matches;
}
