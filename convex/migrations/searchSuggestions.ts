import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { backfillFrom } from "../research/suggestionRefresh";

/**
 * Writes suggested searches (#964) for everyone who searched before they existed: one refresh per
 * person and workspace, spread over ten minutes, through the same path a search asks by. Someone
 * with a set already is left as they are, so it can run again.
 *
 *   npx convex run migrations/searchSuggestions:run
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// A search can be about 700 KB with its query and history: five of the largest stay well within a transaction's 16 MiB of reads, as in ./searchText.ts.
export const backfill = migrations.define({ table: "searches", batchSize: 5, migrateOne: backfillFrom });

export const run = migrations.runner(internal.migrations.searchSuggestions.backfill);
