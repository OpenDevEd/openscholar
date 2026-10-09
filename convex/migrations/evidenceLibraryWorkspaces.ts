import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ensureWorkspace } from "../workspaces/create";

/**
 * Puts every Evidence Library from before workspaces (#650, slice 6) in its organization's
 * workspace, made by the account that created it, and every author profile in its owner's
 * own workspace, as theirs. Saved library data: dry-run each first, then run, then verify.
 * Nothing else on a library changes, and running this again changes nothing.
 *
 *   npx convex run migrations/evidenceLibraryWorkspaces:libraries '{"dryRun":true}'
 *   npx convex run migrations/evidenceLibraryWorkspaces:profiles '{"dryRun":true}'
 *   npx convex run migrations/evidenceLibraryWorkspaces:run
 *   npx convex run migrations/evidenceLibraryWorkspaces:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** The account a library's creator signed in as, while it exists. */
const creatorOf = (ctx: Pick<QueryCtx, "db">, clerkUserId: string) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique();

// A library row holds no configuration, only its pointers: the default batch is small enough.
export const libraries = migrations.define({
  table: "evidenceLibraries",
  migrateOne: async (ctx, library) => {
    const creator = library.createdBy ? null : await creatorOf(ctx, library.createdByClerkUserId);
    const patch = {
      ...(library.workspaceId ? {} : { workspaceId: await ensureWorkspace(ctx, { kind: "organization", organizationId: library.organizationId }) }),
      ...(creator ? { createdBy: creator._id } : {}),
    };
    return Object.keys(patch).length ? patch : undefined;
  },
});

export const profiles = migrations.define({
  table: "authorProfiles",
  migrateOne: async (ctx, profile) => (profile.workspaceId ? undefined : { workspaceId: await ensureWorkspace(ctx, { kind: "personal", userId: profile.ownerId }), createdBy: profile.ownerId }),
});

export const run = migrations.runner([internal.migrations.evidenceLibraryWorkspaces.libraries, internal.migrations.evidenceLibraryWorkspaces.profiles]);

/** Rows on one page of `table` with no workspace yet, or no maker while the account that made it exists. */
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("evidenceLibraries"), v.literal("authorProfiles")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 };
    if (table === "evidenceLibraries") {
      const page = await ctx.db.query(table).paginate(opts);
      let missing = 0;
      for (const library of page.page) if (!library.workspaceId || (!library.createdBy && (await creatorOf(ctx, library.createdByClerkUserId)))) missing++;
      return { missing, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query(table).paginate(opts);
    return { missing: page.page.filter((profile) => !profile.workspaceId || !profile.createdBy).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many libraries and profiles are still to place; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of ["evidenceLibraries", "authorProfiles"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.evidenceLibraryWorkspaces.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
