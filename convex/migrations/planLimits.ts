import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";

/**
 * Clears the papers-at-once limit cached billing rows kept before plan limits (#632), so the
 * field can leave the schema. A refresh from Autumn drops it as well. Safe to run again.
 *
 *   npx convex run migrations/planLimits:run
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const clearConcurrency = migrations.define({
  table: "billingAccounts",
  migrateOne: async (_ctx, account) => (account.concurrency === undefined ? undefined : { concurrency: undefined }),
});

export const run = migrations.runner(internal.migrations.planLimits.clearConcurrency);
