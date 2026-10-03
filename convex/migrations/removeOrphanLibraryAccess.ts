import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Deletes the grants and invitations of libraries that no longer exist (#427). A library's
 * teardown now deletes them itself; before, they stayed, and would count against the limits
 * on a person's grants and on the invitations waiting for an address. Safe to run again.
 *
 *   npx convex run migrations/removeOrphanLibraryAccess:run '{"dryRun": true}'
 *   npx convex run migrations/removeOrphanLibraryAccess:run
 *   npx convex run migrations/removeOrphanLibraryAccess:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const grants = migrations.define({
  table: "evidenceLibraryMembers",
  migrateOne: async (ctx, grant) => {
    if (!(await ctx.db.get("evidenceLibraries", grant.libraryId))) await ctx.db.delete("evidenceLibraryMembers", grant._id);
  },
});

export const invitations = migrations.define({
  table: "evidenceLibraryInvitations",
  migrateOne: async (ctx, invitation) => {
    if (!(await ctx.db.get("evidenceLibraries", invitation.libraryId))) await ctx.db.delete("evidenceLibraryInvitations", invitation._id);
  },
});

export const run = migrations.runner([internal.migrations.removeOrphanLibraryAccess.grants, internal.migrations.removeOrphanLibraryAccess.invitations]);

/** Rows on one page of `table` whose library is gone. */
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("evidenceLibraryMembers"), v.literal("evidenceLibraryInvitations")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const read = { cursor, numItems: 200 };
    const page = table === "evidenceLibraryMembers" ? await ctx.db.query("evidenceLibraryMembers").paginate(read) : await ctx.db.query("evidenceLibraryInvitations").paginate(read);
    let wrong = 0;
    for (const row of page.page) if (!(await ctx.db.get("evidenceLibraries", row.libraryId))) wrong++;
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many grants and invitations still point at a library that's gone; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of ["evidenceLibraryMembers", "evidenceLibraryInvitations"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.removeOrphanLibraryAccess.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
