import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { memberText } from "../lib/searchText";

/**
 * Readies team pages for any organization (#637): every organization membership gets the text the
 * team picker searches. Rows written since are kept by their trigger, and running this again
 * changes nothing. A library's roles are counted with every shared item's guests (#653).
 *
 *   npx convex run migrations/teamLists:run
 *   npx convex run migrations/teamLists:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const memberships = migrations.define({
  table: "organizationMemberships",
  migrateOne: async (ctx, membership) => {
    const text = await memberText(ctx, membership);
    return membership.searchText === text ? undefined : { searchText: text };
  },
});

export const run = migrations.runner([internal.migrations.teamLists.memberships]);

/** Memberships on one page the backfill hasn't reached: ones without their text. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("organizationMemberships").paginate({ cursor, numItems: 100 });
    let wrong = 0;
    for (const membership of page.page) if (membership.searchText !== (await memberText(ctx, membership))) wrong++;
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many memberships `verifyPage` finds wrong; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.teamLists.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
