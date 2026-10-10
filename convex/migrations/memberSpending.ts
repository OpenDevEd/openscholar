import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { memberOp, usageAgg } from "../billing/usageLog";
import { queueCounts } from "../lib/countQueue";

/**
 * Counts each charge made before #652 under the member who spent it, as the ledger counts new ones
 * (../billing/usageLog.ts): a member's spending this month, and the cap on it, read that sum. A
 * charge already counted there stays as it is.
 *
 *   npx convex run migrations/memberSpending:run
 *   npx convex run migrations/memberSpending:verify   # 0 once done
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const charges = migrations.define({
  table: "billingUsage",
  batchSize: 200,
  // Queued, so a batch's counts go to the aggregate in one call when it ends (../lib/countQueue.ts).
  migrateOne: async (ctx, row) => queueCounts(ctx, usageAgg, memberOp(row)),
});

export const run = migrations.runner([internal.migrations.memberSpending.charges]);

/** 1 until the migration has gone through every charge, then 0. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const [status] = await migrations.getStatus(ctx, { migrations: [internal.migrations.memberSpending.charges] });
    return status?.isDone ? 0 : 1;
  },
});
