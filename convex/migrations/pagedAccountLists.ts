import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ADMIN_LIST, listCounts, uncounted, walletKeyList } from "../lib/listCounts";

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
    const opts = { cursor, numItems: 100 };
    if (table === "walletKeys") {
      const page = await ctx.db.query("walletKeys").paginate(opts);
      return { wrong: await uncounted(ctx, page.page, walletKeyList), isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("admins").paginate(opts);
    return { wrong: await uncounted(ctx, page.page, () => ADMIN_LIST), isDone: page.isDone, continueCursor: page.continueCursor };
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
