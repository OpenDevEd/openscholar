import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { ORGANIZATION_PLAN } from "../../lib/billing/plans";

/**
 * Gives every organization from before billing was a workspace's (#650, slice 7) its own
 * Autumn customer on the free organization plan, as the Clerk webhook does for a new one.
 * Each is its own scheduled provisioning, which is safe to run again.
 *
 *   npx convex run migrations/organizationCustomers:run
 *   npx convex run migrations/organizationCustomers:verify
 */
const PAGE = 100;

/** One page of the organizations' workspaces, and those of them whose account isn't on an organization's plan yet. */
export const page = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ workspaces: v.array(v.id("workspaces")), unprovisioned: v.array(v.id("workspaces")), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const read = await ctx.db.query("workspaces").paginate({ cursor, numItems: PAGE });
    const organizations = read.page.filter((workspace) => workspace.kind === "organization");
    const unprovisioned = [];
    for (const workspace of organizations) {
      const account = await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).unique();
      if (!account || (account.plan !== ORGANIZATION_PLAN && !account.hasPaid)) unprovisioned.push(workspace._id);
    }
    return { workspaces: organizations.map((workspace) => workspace._id), unprovisioned, isDone: read.isDone, continueCursor: read.continueCursor };
  },
});

export const run = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let scheduled = 0;
    for (let cursor: string | null = null; ;) {
      const read: { unprovisioned: Id<"workspaces">[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.organizationCustomers.page, { cursor });
      for (const workspaceId of read.unprovisioned) {
        await ctx.scheduler.runAfter(0, internal.billing.accounts.provisionOrganization, { workspaceId });
        scheduled++;
      }
      if (read.isDone) return scheduled;
      cursor = read.continueCursor;
    }
  },
});

/** How many organizations aren't on an organization's plan yet; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (let cursor: string | null = null; ;) {
      const read: { unprovisioned: Id<"workspaces">[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.organizationCustomers.page, { cursor });
      missing += read.unprovisioned.length;
      if (read.isDone) return missing;
      cursor = read.continueCursor;
    }
  },
});
