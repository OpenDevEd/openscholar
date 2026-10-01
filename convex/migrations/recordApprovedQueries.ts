import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { recordApprovedQueries } from "../evidenceLibraries/approvedQueries";

/**
 * Records every approved OpenAlex query version in the libraries' sources revisions, then
 * marks every library recorded, so its sources saves stop reading every revision (#357).
 * Revisions are recorded a batch at a time, so a library with any number of them fits; one
 * whose versions conflict fails the run by name. A revision saved meanwhile is recorded by
 * the trigger on evidenceLibraryConfigSections, so a library is complete when it's marked.
 *
 *   npx convex run migrations/recordApprovedQueries:run '{"dryRun": true}'
 *   npx convex run migrations/recordApprovedQueries:run
 *   npx convex run migrations/recordApprovedQueries:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const recordRevisions = migrations.define({
  table: "evidenceLibraryConfigSections",
  batchSize: 50,
  migrateOne: async (ctx, section) => {
    if (section.kind === "revision" && section.sectionKey === "sources") await recordApprovedQueries(ctx, section.libraryId, section.payload);
  },
});

export const markLibraries = migrations.define({
  table: "evidenceLibraries",
  migrateOne: (_ctx, library) => (library.approvedQueriesRecorded ? undefined : { approvedQueriesRecorded: true as const }),
});

export const run = migrations.runner([internal.migrations.recordApprovedQueries.recordRevisions, internal.migrations.recordApprovedQueries.markLibraries]);

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
