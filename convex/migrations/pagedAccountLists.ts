import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ADMIN_LIST, listCounts, walletKeyList } from "../lib/listCounts";

/**
 * Counts the wallet keys and admins saved before their lists paged (#424), so each list
 * totals its pages from a kept count (lib/listCounts.ts). A key or admin written since is
 * counted by its trigger, and a row is counted once however often this runs.
 *
 *   npx convex run migrations/pagedAccountLists:run '{"dryRun": true}'
 *   npx convex run migrations/pagedAccountLists:run
 *   npx convex run migrations/pagedAccountLists:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const walletKeys = migrations.define({
  table: "walletKeys",
  migrateOne: async (ctx, key) => {
    const list = walletKeyList(key);
    if (list !== null) await listCounts.insertIfDoesNotExist(ctx, { namespace: list, key: null, id: key._id });
  },
});

export const admins = migrations.define({
  table: "admins",
  migrateOne: async (ctx, admin) => {
    await listCounts.insertIfDoesNotExist(ctx, { namespace: ADMIN_LIST, key: null, id: admin._id });
  },
});

export const run = migrations.runner([internal.migrations.pagedAccountLists.walletKeys, internal.migrations.pagedAccountLists.admins]);

const tableValidator = v.union(v.literal("walletKeys"), v.literal("admins"));

/** Rows on one page of `table` that their list doesn't count. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = table === "walletKeys" ? await ctx.db.query("walletKeys").paginate({ cursor, numItems: 100 }) : await ctx.db.query("admins").paginate({ cursor, numItems: 100 });
    const listed = page.page.flatMap((row) => {
      const list = "hashedKey" in row ? walletKeyList(row) : ADMIN_LIST;
      return list === null ? [] : [{ namespace: list, bounds: { lower: { key: null, id: row._id, inclusive: true }, upper: { key: null, id: row._id, inclusive: true } } }];
    });
    const counted = await listCounts.countBatch(ctx, listed);
    return { wrong: counted.filter((count) => count !== 1).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many wallet keys and admins their lists don't count, a page at a time; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of ["walletKeys", "admins"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.pagedAccountLists.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
