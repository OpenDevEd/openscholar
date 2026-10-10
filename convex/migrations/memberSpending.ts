import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { memberOp, usageAgg } from "../billing/usageLog";

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
  migrateOne: async (ctx, row) => {
    const ops = memberOp(row);
    if (ops.length) await usageAgg.enqueueBatch(ctx, ops);
  },
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
