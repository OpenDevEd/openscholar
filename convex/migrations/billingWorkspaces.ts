import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Puts every billing account, charge and hold from before workspaces (#650, slice 7) on its
 * person's own workspace, which is who paid: every customer was a person until now. One whose
 * person has no workspace left (a purged account's charges) keeps none. New rows carry their
 * workspace from the start, and running this again changes nothing.
 *
 *   npx convex run migrations/billingWorkspaces:run
 *   npx convex run migrations/billingWorkspaces:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const own = async (ctx: MutationCtx, userId: Id<"users">) => (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())?._id;
const placed = async (ctx: MutationCtx, row: { userId?: Id<"users">; workspaceId?: Id<"workspaces"> }) => {
  if (row.workspaceId || !row.userId) return undefined;
  const workspaceId = await own(ctx, row.userId);
  return workspaceId ? { workspaceId } : undefined;
};

export const accounts = migrations.define({ table: "billingAccounts", migrateOne: placed });
// A charge row is small: two hundred at a time.
export const usage = migrations.define({ table: "billingUsage", batchSize: 200, migrateOne: placed });
export const holds = migrations.define({ table: "billingHolds", migrateOne: placed });

export const run = migrations.runner([internal.migrations.billingWorkspaces.accounts, internal.migrations.billingWorkspaces.usage, internal.migrations.billingWorkspaces.holds]);

const tables = v.union(v.literal("billingAccounts"), v.literal("billingUsage"), v.literal("billingHolds"));

/** Rows on one page of `table` with no workspace while their person has one. */
export const verifyPage = internalQuery({
  args: { table: tables, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 500, maximumBytesRead: 4 * 1024 * 1024 });
    let missing = 0;
    for (const row of page.page) {
      const userId = row.userId;
      if (!row.workspaceId && userId && (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())) missing++;
    }
    return { missing, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many billing rows are still to place; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of ["billingAccounts", "billingUsage", "billingHolds"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.billingWorkspaces.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
