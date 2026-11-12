/**
 * Where OpenScholar reads an Evidence Library as one of its people (plans/evidence-library-sources):
 * the library an address names, and the running library's address and machine credential. Any
 * running library can be read; the library itself decides what the person may see in it.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import { LIBRARY_SOURCE_MAX } from "../../lib/evidence-libraries/source-address";
import { LIBRARY_KEYS_WINDOW } from "../paperSets/libraryKeys";
import type { librarySourceValidator } from "./validators";
import { internalQuery, query } from "../lib/functions";
import { readLibraryRuntimeTarget } from "./runtimeTarget";
import { createError } from "../lib/errors";

/** Claims of one host read at most: a host is served for one library, and claimed by a few at most. */
const DOMAIN_CLAIMS_READ = 10;

/** The library an address's origin names: one of its custom domains, or the address OpenScholar gave it. */
export async function libraryAt(ctx: Pick<QueryCtx, "db">, origin: string): Promise<Id<"evidenceLibraries"> | null> {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return null;
  }
  // A domain counts once the proxy serves it: one only claimed, or dropped since, names no library.
  const domain = (await ctx.db.query("evidenceLibraryDomains").withIndex("by_host", (q) => q.eq("host", host)).take(DOMAIN_CLAIMS_READ)).find((claim) => claim.attachedAt !== undefined);
  if (domain) return domain.libraryId;
  const binding = await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_targetBaseUrl", (q) => q.eq("targetBaseUrl", `https://${host}`)).first();
  return binding?.libraryId ?? null;
}

/** The library, refused when it isn't running: it has no records to read. Anyone may read a running one, as far as the library lets them. */
export async function requireRunningLibrary(ctx: Pick<QueryCtx, "db">, libraryId: Id<"evidenceLibraries">) {
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library || !(await readLibraryRuntimeTarget(ctx, library))) throw createError("NOT_FOUND", "This Evidence Community isn't running, so its records can't be read.");
  return library;
}

/**
 * A source's record keys `first` to `last` (from 1), at most LIBRARY_SOURCE_MAX of them, as the person may read them:
 * asked a window at a time, since a Convex array holds 8,192 values. Kept in the action, which holds any number.
 */
export async function resolveLibraryKeys(ctx: ActionCtx, request: { libraryId: Id<"evidenceLibraries">; userId: Id<"users">; source: Infer<typeof librarySourceValidator>; first: number; last: number }) {
  const last = Math.min(request.last, request.first + LIBRARY_SOURCE_MAX - 1);
  const keys: string[] = [];
  for (let from = request.first; from <= last; from += LIBRARY_KEYS_WINDOW) {
    const read: { keys: string[] } = await ctx.runAction(internal.evidenceLibraries.sourceActions.resolve, { ...request, first: from, last: Math.min(last, from + LIBRARY_KEYS_WINDOW - 1) });
    keys.push(...read.keys);
    if (read.keys.length < LIBRARY_KEYS_WINDOW) break;
  }
  return keys;
}

/** Keeps a job's keys for one source a window at a time, the first window first (../paperSets/libraryKeys.ts `keep`). Says whether all were kept. */
export async function keepLibraryKeys(ctx: ActionCtx, job: Id<"screeningJobs"> | Id<"extractionJobs">, keys: string[], { part = 0, epoch, from = 0 }: { part?: number; epoch?: number; from?: number } = {}) {
  for (let at = from; at < keys.length || at === 0; at += LIBRARY_KEYS_WINDOW) {
    const kept: boolean = await ctx.runMutation(internal.paperSets.libraryKeys.keep, { job, part, from: at, keys: keys.slice(at, at + LIBRARY_KEYS_WINDOW), ...(epoch === undefined ? {} : { epoch }) });
    if (!kept) return false;
  }
  return true;
}

/** A running library's name and the address and encrypted credential OpenScholar reads it with; null for one that isn't running. */
export const target = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(v.null(), v.object({ name: v.string(), targetBaseUrl: v.string(), encryptedMachineCredential: v.string() })),
  handler: async (ctx, { libraryId }) => {
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    const found = library ? await readLibraryRuntimeTarget(ctx, library) : null;
    return library && found ? { name: library.name, ...found } : null;
  },
});

/** The library an address names, by its origin. */
export const at = internalQuery({
  args: { origin: v.string() },
  returns: v.union(v.null(), v.id("evidenceLibraries")),
  handler: async (ctx, { origin }) => await libraryAt(ctx, origin),
});

/**
 * Whether a community answers at an address. For the sign-out page (app/sign-out), which a community sends its reader
 * through and which sends them back: it goes back only to a community's own address, never to wherever a link says.
 */
export const isCommunity = query({
  args: { origin: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { origin }) => (await libraryAt(ctx, origin)) !== null,
});

/** Who a person is to a library: their Clerk user ID, which the library knows them by. */
export const readerOf = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), v.string()),
  // Only an account that can still act: a library is never asked anything as one suspended or deleted since, as a job's
  // writes queued before would.
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    return user?.state === "active" ? user.clerkId : null;
  },
});
