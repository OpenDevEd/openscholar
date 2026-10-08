import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ensureWorkspace } from "../workspaces/create";

/**
 * Gives every account and organization from before workspaces their own (#650), deleted ones
 * too, since their records move into it. Accounts and organizations made since get theirs
 * when they're made, and running this again changes nothing.
 *
 *   npx convex run migrations/workspaces:run
 *   npx convex run migrations/workspaces:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const accounts = migrations.define({
  table: "users",
  migrateOne: async (ctx, user) => {
    await ensureWorkspace(ctx, { kind: "personal", userId: user._id });
  },
});

export const organizations = migrations.define({
  table: "organizations",
  migrateOne: async (ctx, organization) => {
    await ensureWorkspace(ctx, { kind: "organization", organizationId: organization._id });
  },
});

export const run = migrations.runner([internal.migrations.workspaces.accounts, internal.migrations.workspaces.organizations]);

const tableValidator = v.union(v.literal("users"), v.literal("organizations"));

/** Accounts or organizations on one page that have no workspace yet. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100 };
    let missing = 0;
    if (table === "users") {
      const page = await ctx.db.query("users").paginate(opts);
      for (const user of page.page) if (!(await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", user._id)).first())) missing++;
      return { missing, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("organizations").paginate(opts);
    for (const organization of page.page) if (!(await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organization._id)).first())) missing++;
    return { missing, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many accounts and organizations have no workspace; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of ["users", "organizations"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.workspaces.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
