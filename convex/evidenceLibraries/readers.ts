/**
 * The Evidence Libraries a person reads (plans/evidence-library-sources): the ones they signed in
 * to, which the library tells OpenScholar each time it checks a reader, and the ones they opened a
 * hand-off from. The ones they have a role on come from their organizations and aren't kept here.
 * A library's sources are offered from these, and any other library is reached by its address.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { createError } from "../lib/errors";
import { assistantQuery, defineUserQuery, userQuery, workspaceQuery } from "../lib/userActions";
import { workspacesOf } from "../workspaces/personal";
import { findMatchingLibraryServiceCredential } from "./credentials";
import { readEvidenceLibraryAdminLaunchTarget } from "./setupRecords";
import { READ_LIBRARIES_MAX, readLibrariesValidator, type libraryListRoleValidator } from "./validators";
import { libraryOf, readLibraryRole } from "./access";

/** A reader's last visit is written at most this often: the library reports one every 15 minutes while they're there. */
const TOUCH_MS = 60 * 60 * 1000;

/** Notes that a person reads a library, or still does. */
export async function noteReader(ctx: MutationCtx, libraryId: Id<"evidenceLibraries">, userId: Id<"users">, via: "signIn" | "handoff") {
  const row = await ctx.db.query("evidenceLibraryReaders").withIndex("by_library_and_user", (q) => q.eq("libraryId", libraryId).eq("userId", userId)).unique();
  const now = Date.now();
  if (!row) return void (await ctx.db.insert("evidenceLibraryReaders", { libraryId, userId, via, firstAt: now, lastAt: now }));
  if (now - row.lastAt >= TOUCH_MS || row.via !== via) await ctx.db.patch("evidenceLibraryReaders", row._id, { via, lastAt: now });
}

/** The library whose service credential this is, or a refusal. */
export async function credentialedLibrary(ctx: Pick<QueryCtx, "db">, libraryId: string, credentialDigest: string) {
  const id = ctx.db.normalizeId("evidenceLibraries", libraryId);
  if (!id || !(await findMatchingLibraryServiceCredential(ctx, { libraryId: id, credentialDigest }))) throw createError("UNAUTHENTICATED", "Invalid community service credential");
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

type Role = Infer<typeof libraryListRoleValidator>;
export type ReadLibrary = { library: Doc<"evidenceLibraries">; address: string; ways: Array<"signIn" | "handoff" | "role">; role: Role | null; faviconUrl: string | null; lastAt: number };

/** The favicon a running library shows, from its live configuration. */
export async function faviconOf(ctx: Pick<QueryCtx, "db">, library: Doc<"evidenceLibraries">) {
  if (!library.activeRevisionId) return null;
  const identity = await ctx.db.query("evidenceLibraryConfigSections").withIndex("by_revisionId_and_sectionKey", (q) => q.eq("revisionId", library.activeRevisionId).eq("sectionKey", "identity")).unique();
  const favicon = (identity?.payload as { assets?: { favicon?: unknown } } | undefined)?.assets?.favicon;
  return typeof favicon === "string" && favicon ? favicon : null;
}

/**
 * The libraries a person reads, last used first: the ones they signed in to or opened a hand-off
 * from, and the ones they have a role on: their own workspace's, their organizations' and the ones
 * granted to them. Only running libraries count: one being set up or turned off has nothing to read.
 */
export async function librariesOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">): Promise<ReadLibrary[]> {
  const user = await ctx.db.get("users", userId);
  if (!user) return [];
  const found = new Map<Id<"evidenceLibraries">, { library: Doc<"evidenceLibraries">; ways: Set<"signIn" | "handoff" | "role">; lastAt: number }>();
  const add = (library: Doc<"evidenceLibraries">, way: "signIn" | "handoff" | "role", lastAt: number) => {
    const known = found.get(library._id);
    if (known) known.ways.add(way);
    else found.set(library._id, { library, ways: new Set([way]), lastAt });
  };
  const rows = await ctx.db.query("evidenceLibraryReaders").withIndex("by_user_and_lastAt", (q) => q.eq("userId", userId)).order("desc").take(READ_LIBRARIES_MAX);
  for (const row of rows) {
    const library = await ctx.db.get("evidenceLibraries", row.libraryId);
    if (library) add(library, row.via, row.lastAt);
  }
  // At most READ_LIBRARIES_MAX libraries come from roles, however many workspaces the person is in.
  let roles = 0;
  for (const workspace of await workspacesOf(ctx, userId)) {
    if (roles >= READ_LIBRARIES_MAX) break;
    const libraries = await ctx.db.query("evidenceLibraries").withIndex("by_workspace_and_state", (q) => q.eq("workspaceId", workspace._id).eq("state", "active")).take(READ_LIBRARIES_MAX - roles);
    roles += libraries.length;
    for (const library of libraries) add(library, "role", library._creationTime);
  }
  const grants = await ctx.db.query("itemAccess").withIndex("by_user_and_kind_and_grantedAt", (q) => q.eq("userId", userId).eq("kind", "library")).order("desc").take(READ_LIBRARIES_MAX);
  for (const grant of grants) {
    const library = await libraryOf(ctx, grant);
    if (library?.state === "active") add(library, "role", grant.grantedAt);
  }
  const listed = await Promise.all(
    [...found.values()].map(async (entry) => {
      const address = await readEvidenceLibraryAdminLaunchTarget(ctx, entry.library);
      if (!address) return null;
      // An organization's member who is none of its admins views its libraries.
      const role: Role | null = entry.ways.has("role") ? ((await readLibraryRole(ctx, entry.library, user.clerkId)) ?? "viewer") : null;
      return { library: entry.library, address, ways: [...entry.ways], role, faviconUrl: await faviconOf(ctx, entry.library), lastAt: entry.lastAt };
    }),
  );
  return listed
    .flatMap((entry) => (entry ? [entry] : []))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, READ_LIBRARIES_MAX);
}

export const listAction = defineUserQuery({
  path: "evidenceLibraries/readers:list",
  description:
    `The Evidence Communities the person reads, last used first, at most ${READ_LIBRARIES_MAX}: each one's ID, name and address, how it is theirs (\`signIn\`: they signed in to it; \`handoff\`: they opened its records here; \`role\`: they have a role on it, which \`role\` names). ` +
    "Any other community Openscholar runs is reached by its address.",
  args: {},
  returns: readLibrariesValidator,
  run: async (ctx, { userId }) => (await librariesOf(ctx, userId)).map(({ library, address, ways, role, faviconUrl }) => ({ libraryId: library._id, name: library.name, address, ways, role, faviconUrl })),
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

/** Where a running library is, for its records to open on it; null for one that isn't running. */
export const address = workspaceQuery({
  // Taken as text: it comes from a paper's key, which a page holds as text.
  args: { libraryId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, _actor, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    const library = libraryId ? await ctx.db.get("evidenceLibraries", libraryId) : null;
    return library ? await readEvidenceLibraryAdminLaunchTarget(ctx, library) : null;
  },
});

/** A library that is running, as a person's list shows it: its name, address and favicon. Null for one that isn't. */
export const running = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(v.null(), v.object({ name: v.string(), address: v.string(), faviconUrl: v.union(v.string(), v.null()) })),
  handler: async (ctx, { libraryId }) => {
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    const address = library ? await readEvidenceLibraryAdminLaunchTarget(ctx, library) : null;
    return library && address ? { name: library.name, address, faviconUrl: await faviconOf(ctx, library) } : null;
  },
});
