import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { readSourcesRevisions, recordApprovedQueries } from "../evidenceLibraries/approvedQueries";

/**
 * Records every approved OpenAlex query version in each library's sources revisions and
 * marks the library recorded, so its sources saves stop reading every revision (#357).
 * One library per transaction; a library with conflicting versions fails the run by name.
 * New revisions are recorded by the trigger on evidenceLibraryConfigSections meanwhile.
 *
 *   npx convex run migrations/recordApprovedQueries:run '{"dryRun": true}'
 *   npx convex run migrations/recordApprovedQueries:run
 *   npx convex run migrations/recordApprovedQueries:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const recordLibraries = migrations.define({
  table: "evidenceLibraries",
  batchSize: 1,
  migrateOne: async (ctx, library) => {
    if (library.approvedQueriesRecorded) return;
    for (const payload of await readSourcesRevisions(ctx, library._id)) await recordApprovedQueries(ctx, library._id, payload);
    return { approvedQueriesRecorded: true as const };
  },
});

export const run = migrations.runner(internal.migrations.recordApprovedQueries.recordLibraries);

/** One page of libraries not recorded yet, for `verify`. */
export const unrecordedPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ unrecorded: v.array(v.id("evidenceLibraries")), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("evidenceLibraries").paginate({ cursor, numItems: 200 });
    return { unrecorded: page.page.filter((library) => !library.approvedQueriesRecorded).map((library) => library._id), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Libraries not recorded yet; none when the migration is done. */
export const verify = internalAction({
  args: {},
  returns: v.array(v.id("evidenceLibraries")),
  handler: async (ctx): Promise<Id<"evidenceLibraries">[]> => {
    const unrecorded: Id<"evidenceLibraries">[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { unrecorded: Id<"evidenceLibraries">[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.recordApprovedQueries.unrecordedPage, { cursor });
      unrecorded.push(...page.unrecorded);
      if (page.isDone) return unrecorded;
      cursor = page.continueCursor;
    }
  },
});
