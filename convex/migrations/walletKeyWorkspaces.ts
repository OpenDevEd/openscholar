import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { personalWorkspaceOf } from "../workspaces/personal";

/**
 * Gives every connected app's key the workspace it draws on (#651): the keys made before /connect
 * asked which one draw on their person's own. Once it has run, walletKeys.workspaceId is required.
 *
 *   npx convex run migrations/walletKeyWorkspaces:run
 *   npx convex run migrations/walletKeyWorkspaces:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const keys = migrations.define({
  table: "walletKeys",
  batchSize: 200,
  migrateOne: async (ctx, key) => {
    if (key.workspaceId === undefined) await ctx.db.patch("walletKeys", key._id, { workspaceId: await personalWorkspaceOf(ctx, key.userId) });
  },
});

export const run = migrations.runner(internal.migrations.walletKeyWorkspaces.keys);

/** Keys on one page with no workspace. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("walletKeys").paginate({ cursor, numItems: 500 });
    return { wrong: page.page.filter((key) => key.workspaceId === undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many keys have no workspace; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.walletKeyWorkspaces.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) return wrong;
      cursor = page.continueCursor;
    }
  },
});
