import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { searchTextOf } from "../screening/mutations";

/**
 * Gives screening results from before a job's list searched by index the text it searches
 * (#635): their title and authors. Safe to run again.
 *
 *   npx convex run migrations/screeningSearch:run
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const results = migrations.define({
  table: "screeningResults",
  migrateOne: async (_ctx, result) => {
    const searchText = searchTextOf({ title: result.title, authors: result.authors });
    return result.searchText === searchText ? undefined : { searchText };
  },
});

export const run = migrations.runner(internal.migrations.screeningSearch.results);
