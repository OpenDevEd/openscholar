import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Clears the switches set by hand in Clerk from every organization (#652): plans grant features
 * now, and nothing reads or writes them. Once it has run on each deployment the fields go.
 *
 *   npx convex run migrations/organizationSwitches:run
 *   npx convex run migrations/organizationSwitches:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const held = (organization: Doc<"organizations">) =>
  organization.evidenceLibrariesEnabled !== undefined || organization.authorsEnabled !== undefined || organization.extractionEnabled !== undefined;

export const organizations = migrations.define({
  table: "organizations",
  migrateOne: (_ctx, organization) => (held(organization) ? { evidenceLibrariesEnabled: undefined, authorsEnabled: undefined, extractionEnabled: undefined } : undefined),
});

export const run = migrations.runner(internal.migrations.organizationSwitches.organizations);

/** Organizations on one page that still hold a switch. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ held: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("organizations").paginate({ cursor, numItems: 200 });
    return { held: page.page.filter(held).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many organizations still hold a switch; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let left = 0;
    for (let cursor: string | null = null; ;) {
      const page: { held: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.organizationSwitches.verifyPage, { cursor });
      left += page.held;
      if (page.isDone) return left;
      cursor = page.continueCursor;
    }
  },
});
