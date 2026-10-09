import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Clears the person a cached billing account named before workspaces (#650, slice 8): an
 * account is its workspace's. Nothing reads the field any more; once this reports 0 on every
 * deployment, it goes from the schema. Running it again changes nothing.
 *
 *   npx convex run migrations/narrowBilling:run
 *   npx convex run migrations/narrowBilling:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const accounts = migrations.define({
  table: "billingAccounts",
  migrateOne: (_ctx, account) => (account.userId === undefined ? undefined : { userId: undefined }),
});

export const run = migrations.runner(internal.migrations.narrowBilling.accounts);

/** Accounts on one page that still name a person. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("billingAccounts").paginate({ cursor, numItems: 200, maximumBytesRead: 4 * 1024 * 1024 });
    return { missing: page.page.filter((account) => account.userId !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many accounts still name a person; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (let cursor: string | null = null; ;) {
      const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.narrowBilling.verifyPage, { cursor });
      missing += page.missing;
      if (page.isDone) return missing;
      cursor = page.continueCursor;
    }
  },
});
