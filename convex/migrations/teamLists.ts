import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { libraryMembersOf, listCounts, personGrantsOf, uncounted } from "../lib/listCounts";
import { memberText } from "../lib/searchText";

/**
 * Readies team pages for any organization (#637): every library grant is counted under its
 * library and its person, which granting another checks against its cap, and every
 * organization membership gets the text the team picker searches. Rows written since are kept
 * by their triggers, and running this again changes nothing.
 *
 *   npx convex run migrations/teamLists:run
 *   npx convex run migrations/teamLists:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const grants = migrations.define({
  table: "evidenceLibraryMembers",
  migrateOne: async (ctx, grant) => {
    await listCounts.insertIfDoesNotExist(ctx, { namespace: libraryMembersOf(grant.libraryId), key: null, id: grant._id });
    await listCounts.insertIfDoesNotExist(ctx, { namespace: personGrantsOf(grant.clerkUserId), key: null, id: grant._id });
  },
});

export const memberships = migrations.define({
  table: "organizationMemberships",
  migrateOne: async (ctx, membership) => {
    const text = await memberText(ctx, membership);
    return membership.searchText === text ? undefined : { searchText: text };
  },
});

export const run = migrations.runner([internal.migrations.teamLists.grants, internal.migrations.teamLists.memberships]);

const tableValidator = v.union(v.literal("evidenceLibraryMembers"), v.literal("organizationMemberships"));

/** Rows on one page of `table` the backfill hasn't reached: a grant either count misses, a membership without its text. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100 };
    if (table === "evidenceLibraryMembers") {
      const page = await ctx.db.query("evidenceLibraryMembers").paginate(opts);
      const wrong = (await uncounted(ctx, page.page, (grant) => libraryMembersOf(grant.libraryId))) + (await uncounted(ctx, page.page, (grant) => personGrantsOf(grant.clerkUserId)));
      return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("organizationMemberships").paginate(opts);
    let wrong = 0;
    for (const membership of page.page) if (membership.searchText !== (await memberText(ctx, membership))) wrong++;
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many rows `verifyPage` finds wrong across both tables; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of ["evidenceLibraryMembers", "organizationMemberships"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.teamLists.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
