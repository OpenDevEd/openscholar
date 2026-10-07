import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { adminText, jobText, searchText, shortcutText } from "../lib/searchText";

/**
 * Gives rows from before the lists searched by index the text their search matches (#636):
 * saved searches, bookmarks, extraction jobs and admins. Rows written since get it from their
 * triggers (lib/searchText.ts). Safe to run again.
 *
 *   npx convex run migrations/searchText:run
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const searches = migrations.define({
  table: "searches",
  migrateOne: async (_ctx, row) => (row.searchText === searchText(row.data) ? undefined : { searchText: searchText(row.data) }),
});

export const shortcuts = migrations.define({
  table: "queryShortcuts",
  migrateOne: async (_ctx, row) => (row.searchText === shortcutText(row.data) ? undefined : { searchText: shortcutText(row.data) }),
});

export const jobs = migrations.define({
  table: "extractionJobs",
  migrateOne: async (_ctx, row) => (row.searchText === jobText(row) ? undefined : { searchText: jobText(row) }),
});

export const admins = migrations.define({
  table: "admins",
  migrateOne: async (ctx, row) => {
    const text = await adminText(ctx, row);
    return row.searchText === text ? undefined : { searchText: text };
  },
});

export const run = migrations.runner([internal.migrations.searchText.searches, internal.migrations.searchText.shortcuts, internal.migrations.searchText.jobs, internal.migrations.searchText.admins]);
