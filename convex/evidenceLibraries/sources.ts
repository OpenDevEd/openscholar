/**
 * Where OpenScholar reads an Evidence Library as one of its people (plans/evidence-library-sources):
 * the library an address names, and the running library's address and machine credential. Any
 * running library can be read; the library itself decides what the person may see in it.
 */
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internalQuery } from "../lib/functions";
import { readLibraryRuntimeTarget } from "./runtimeTarget";
import { createError } from "../lib/errors";

/** The library an address's origin names: one of its custom domains, or the address OpenScholar gave it. */
export async function libraryAt(ctx: Pick<QueryCtx, "db">, origin: string): Promise<Id<"evidenceLibraries"> | null> {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return null;
  }
  const domain = await ctx.db.query("evidenceLibraryDomains").withIndex("by_host", (q) => q.eq("host", host)).first();
  if (domain) return domain.libraryId;
  const binding = await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_targetBaseUrl", (q) => q.eq("targetBaseUrl", `https://${host}`)).first();
  return binding?.libraryId ?? null;
}

/** The library, refused when it isn't running: it has no records to read. Anyone may read a running one, as far as the library lets them. */
export async function requireRunningLibrary(ctx: Pick<QueryCtx, "db">, libraryId: Id<"evidenceLibraries">) {
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library || !(await readLibraryRuntimeTarget(ctx, library))) throw createError("NOT_FOUND", "This Evidence Library isn't running, so its records can't be read.");
  return library;
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

/** Who a person is to a library: their Clerk user ID, which the library knows them by. */
export const readerOf = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { userId }) => (await ctx.db.get("users", userId))?.clerkId ?? null,
});
