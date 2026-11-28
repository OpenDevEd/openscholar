import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { titleKeyOf } from "../screening/checks";

/**
 * Works out again the title key each screening paper is matched on (../screening/checks.ts `titleKeyOf`), since it
 * keeps the marks of scripts other than Latin, Greek and Cyrillic: a paper whose title has them is found by a later
 * record of it, and two papers whose titles differ only by them stay two. Safe to run again: a paper whose key is
 * right is passed over.
 *
 *   npx convex run migrations/screeningTitleKeys:run '{"dryRun": true}'
 *   npx convex run migrations/screeningTitleKeys:run
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const papers = migrations.define({
  table: "screeningResults",
  batchSize: 200,
  migrateOne: (_ctx, paper) => {
    if (paper.titleKey === undefined) return;
    const titleKey = titleKeyOf(paper.title, paper.publicationYear);
    return titleKey === paper.titleKey ? undefined : { titleKey };
  },
});

export const run = migrations.runner(internal.migrations.screeningTitleKeys.papers);
