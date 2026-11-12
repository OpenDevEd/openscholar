import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import { requestRefresh } from "../billing/accounts";

/**
 * Tells a workspace's activations apart by kind (`activationGrants`) on accounts cached before they were. Each account
 * loses the old `activationsRefill`, and one with activations is read from Autumn again, which writes its kinds. Run
 * once per deployment, then drop `activationsRefill` from `billingAccountFields`:
 *   npx convex run migrations/activationKinds:run
 * Safe to run again.
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("billingAccounts").paginate({ numItems: 100, cursor: cursor ?? null });
    for (const account of page.page) {
      // One with activations, or one that refilled and is empty now, has kinds to show.
      if (account.activationGrants === undefined && ((account.activations !== 0 && account.activations !== undefined) || account.activationsRefill !== undefined)) await requestRefresh(ctx, account.workspaceId);
      if (account.activationsRefill !== undefined) await ctx.db.patch("billingAccounts", account._id, { activationsRefill: undefined });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.activationKinds.run, { cursor: page.continueCursor });
    return null;
  },
});
