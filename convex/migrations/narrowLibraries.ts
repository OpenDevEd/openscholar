import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Clears who an Evidence Library and an author profile belonged to before workspaces (#650,
 * slice 8): a library's organization and a profile's owner. Both are their workspace's, and a
 * profile keeps who made it as `createdBy`. Nothing reads either field any more; once this
 * reports 0 on every deployment, they go from the schema. Running it again changes nothing.
 *
 *   npx convex run migrations/narrowLibraries:run
 *   npx convex run migrations/narrowLibraries:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const libraries = migrations.define({
  table: "evidenceLibraries",
  batchSize: 5,
  migrateOne: (_ctx, library) => (library.organizationId === undefined ? undefined : { organizationId: undefined }),
});

// A library and a profile have fields with no byte cap of their own: five at a time.
export const profiles = migrations.define({
  table: "authorProfiles",
  batchSize: 5,
  migrateOne: (_ctx, profile) => (profile.ownerId === undefined ? undefined : { ownerId: undefined }),
});

export const run = migrations.runner([internal.migrations.narrowLibraries.libraries, internal.migrations.narrowLibraries.profiles]);

/** Rows on one page of `table` that still name their owner from before workspaces. */
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("evidenceLibraries"), v.literal("authorProfiles")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 };
    if (table === "evidenceLibraries") {
      const page = await ctx.db.query("evidenceLibraries").paginate(opts);
      return { missing: page.page.filter((library) => library.organizationId !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("authorProfiles").paginate(opts);
    return { missing: page.page.filter((profile) => profile.ownerId !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many libraries and profiles are left; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of ["evidenceLibraries", "authorProfiles"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.narrowLibraries.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
