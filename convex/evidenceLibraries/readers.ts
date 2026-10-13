/**
 * The Evidence Libraries a person reads (plans/evidence-library-sources): the ones they signed in
 * to, which the library tells OpenScholar each time it checks a reader, and the ones they opened a
 * hand-off from. The ones they have a role on come from their organizations and aren't kept here.
 * A library's sources are offered from these, and any other library is reached by its address.
 */
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { createError } from "../lib/errors";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { workspacesOf } from "../workspaces/personal";
import { findMatchingLibraryServiceCredential } from "./credentials";
import { readEvidenceLibraryAdminLaunchTarget } from "./setupRecords";
import { readerWayValidator } from "./validators";

/** A reader's last visit is written at most this often: the library reports one every 15 minutes while they're there. */
const TOUCH_MS = 60 * 60 * 1000;
/** Libraries a person's list holds at most. */
export const READ_LIBRARIES_MAX = 50;
/** Libraries one organization has at most, as its list reads them. */
const WORKSPACE_LIBRARIES_MAX = 200;

/** Notes that a person reads a library, or still does. */
export async function noteReader(ctx: MutationCtx, libraryId: Id<"evidenceLibraries">, userId: Id<"users">, via: "signIn" | "handoff") {
  const row = await ctx.db.query("evidenceLibraryReaders").withIndex("by_library_and_user", (q) => q.eq("libraryId", libraryId).eq("userId", userId)).unique();
  const now = Date.now();
  if (!row) return void (await ctx.db.insert("evidenceLibraryReaders", { libraryId, userId, via, firstAt: now, lastAt: now }));
  if (now - row.lastAt >= TOUCH_MS || row.via !== via) await ctx.db.patch("evidenceLibraryReaders", row._id, { via, lastAt: now });
}

/** The library whose service credential this is, or a refusal. */
async function credentialedLibrary(ctx: Pick<QueryCtx, "db">, libraryId: string, credentialDigest: string) {
  const id = ctx.db.normalizeId("evidenceLibraries", libraryId);
  if (!id || !(await findMatchingLibraryServiceCredential(ctx, { libraryId: id, credentialDigest }))) throw createError("UNAUTHENTICATED", "Invalid library service credential");
  return id;
}

/** How many of a purged person's library rows go per cleanup run. */
const PURGE_READERS = 200;

/** Deletes a step of the libraries a purged person read. Returns whether all are gone. */
export async function purgeReaders(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("evidenceLibraryReaders").withIndex("by_user_and_lastAt", (q) => q.eq("userId", userId)).take(PURGE_READERS);
  for (const row of rows) await ctx.db.delete("evidenceLibraryReaders", row._id);
  return rows.length < PURGE_READERS;
}

/** A library says one of its readers signed in, or is still there (new-el `reportReaderSeen`). An account OpenScholar doesn't know is passed over. */
export const seen = internalMutation({
  args: { libraryId: v.string(), clerkUserId: v.string(), credentialDigest: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const libraryId = await credentialedLibrary(ctx, args.libraryId, args.credentialDigest);
    const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkUserId)).unique();
    if (user?.state === "active") await noteReader(ctx, libraryId, user._id, "signIn");
    return null;
  },
});

/** A page of a library's earlier readers, from its own list of them (./sourceActions.ts `backfillReaders`). */
export const noteReaders = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), clerkUserIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { libraryId, clerkUserIds }) => {
    for (const clerkId of clerkUserIds.slice(0, 500)) {
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();
      if (user?.state === "active") await noteReader(ctx, libraryId, user._id, "signIn");
    }
    return null;
  },
});

export type ReadLibrary = { library: Doc<"evidenceLibraries">; address: string; ways: Array<"signIn" | "handoff" | "role">; lastAt: number };

/**
 * The libraries a person reads, last used first: the ones they signed in to or opened a hand-off
 * from, and the running libraries of their own workspace and their organizations'. Only running
 * libraries count: one being set up or turned off has nothing to read.
 */
export async function librariesOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">): Promise<ReadLibrary[]> {
  const found = new Map<Id<"evidenceLibraries">, { library: Doc<"evidenceLibraries">; ways: Set<"signIn" | "handoff" | "role">; lastAt: number }>();
  const rows = await ctx.db.query("evidenceLibraryReaders").withIndex("by_user_and_lastAt", (q) => q.eq("userId", userId)).order("desc").take(READ_LIBRARIES_MAX);
  for (const row of rows) {
    const library = await ctx.db.get("evidenceLibraries", row.libraryId);
    if (library) found.set(library._id, { library, ways: new Set([row.via]), lastAt: row.lastAt });
  }
  for (const workspace of await workspacesOf(ctx, userId)) {
    const libraries = await ctx.db.query("evidenceLibraries").withIndex("by_workspace_and_state", (q) => q.eq("workspaceId", workspace._id).eq("state", "active")).take(WORKSPACE_LIBRARIES_MAX);
    for (const library of libraries) {
      const known = found.get(library._id);
      if (known) known.ways.add("role");
      else found.set(library._id, { library, ways: new Set(["role"]), lastAt: library._creationTime });
    }
  }
  const listed = await Promise.all([...found.values()].map(async (entry) => ({ ...entry, address: await readEvidenceLibraryAdminLaunchTarget(ctx, entry.library) })));
  return listed
    .flatMap(({ library, ways, lastAt, address }) => (address ? [{ library, address, ways: [...ways], lastAt }] : []))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, READ_LIBRARIES_MAX);
}

const readLibraryValidator = v.object({
  libraryId: v.id("evidenceLibraries"),
  name: v.string(),
  address: v.string(),
  ways: v.array(v.union(readerWayValidator, v.literal("role"))),
});

export const listAction = defineUserQuery({
  path: "evidenceLibraries/readers:list",
  description:
    `The Evidence Libraries the person reads, last used first, at most ${READ_LIBRARIES_MAX}: each one's ID, name and address, and how it is theirs (\`signIn\`: they signed in to it; \`handoff\`: they opened its records here; \`role\`: their organization runs it). ` +
    "Any other library OpenScholar runs is reached by its address.",
  args: {},
  returns: v.array(readLibraryValidator),
  run: async (ctx, { userId }) => (await librariesOf(ctx, userId)).map(({ library, address, ways }) => ({ libraryId: library._id, name: library.name, address, ways })),
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

/** Whether a library is running, with its address: what a person reads it by. */
export const running = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(v.null(), v.object({ name: v.string(), address: v.string() })),
  handler: async (ctx, { libraryId }) => {
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    const address = library ? await readEvidenceLibraryAdminLaunchTarget(ctx, library) : null;
    return library && address ? { name: library.name, address } : null;
  },
});
