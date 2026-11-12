import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../lib/functions";
import { customerOf } from "../billing/accounts";
import { AutumnError, autumn } from "../billing/autumn";
import { ACTIVATIONS_FEATURE } from "../../lib/billing/plans";

/**
 * Moves free activations to the balance Autumn keeps (#1261). A workspace an admin gave free activations a day gets
 * that many in its balance in Autumn, refilled every day, and its `reportLimits` row goes. What the old count left
 * behind is cleared: `free`, `unbilled` and `refund` on `reportActivations`, `perDay` and `orgPerDay` on
 * `reportSettings`. The two default numbers were for every workspace of a kind: one that isn't 0 is logged, to be set
 * as an item on that kind's plan in Autumn's dashboard. Run once per deployment, then drop the table and the fields:
 *   npx convex run migrations/activationBalance:run
 * Safe to run again.
 */
export const run = internalAction({
  args: {},
  returns: v.object({ moved: v.number() }),
  handler: async (ctx): Promise<{ moved: number }> => {
    let moved = 0;
    for (;;) {
      const limits: Array<{ limitId: Id<"reportLimits">; customerId: string; perDay: number }> = await ctx.runQuery(internal.migrations.activationBalance.limits, {});
      if (limits.length === 0) break;
      for (const { limitId, customerId, perDay } of limits) {
        if (perDay > 0) {
          await autumn.customer(customerId);
          // Keyed by the row, so a run that stops between giving the balance and dropping the row never gives it twice:
          // asked again, Autumn refuses the key it has seen, and the row only has to go.
          await autumn.createBalance({ customerId, feature: ACTIVATIONS_FEATURE, amount: perDay, interval: "day", idempotencyKey: `activation-limit-${limitId}` }).catch((error: unknown) => {
            if (!(error instanceof AutumnError && error.code === "duplicate_idempotency_key")) throw error;
          });
          console.log(JSON.stringify({ event: "activation-limit-moved", customerId, perDay }));
          moved++;
        }
        await ctx.runMutation(internal.migrations.activationBalance.dropLimit, { limitId });
      }
    }
    await ctx.runMutation(internal.migrations.activationBalance.clear, {});
    return { moved };
  },
});

export const limits = internalQuery({
  args: {},
  returns: v.array(v.object({ limitId: v.id("reportLimits"), customerId: v.string(), perDay: v.number() })),
  handler: async (ctx) => {
    const rows = await ctx.db.query("reportLimits").take(50);
    return await Promise.all(rows.map(async (row) => ({ limitId: row._id, customerId: await customerOf(ctx, row.workspaceId), perDay: row.perDay })));
  },
});

export const dropLimit = internalMutation({
  args: { limitId: v.id("reportLimits") },
  returns: v.null(),
  handler: async (ctx, { limitId }) => {
    if (await ctx.db.get("reportLimits", limitId)) await ctx.db.delete("reportLimits", limitId);
    return null;
  },
});

export const clear = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    if (!cursor) {
      const settings = await ctx.db.query("reportSettings").first();
      if (settings && (settings.perDay !== undefined || settings.orgPerDay !== undefined)) {
        if (settings.perDay || settings.orgPerDay) console.log(JSON.stringify({ event: "activation-defaults-dropped", perDay: settings.perDay, orgPerDay: settings.orgPerDay }));
        await ctx.db.patch("reportSettings", settings._id, { perDay: undefined, orgPerDay: undefined });
      }
    }
    const page = await ctx.db.query("reportActivations").paginate({ numItems: 200, cursor: cursor ?? null });
    for (const row of page.page) {
      if (row.free !== undefined || row.unbilled !== undefined || row.refund !== undefined) await ctx.db.patch("reportActivations", row._id, { free: undefined, unbilled: undefined, refund: undefined });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.activationBalance.clear, { cursor: page.continueCursor });
    return null;
  },
});
