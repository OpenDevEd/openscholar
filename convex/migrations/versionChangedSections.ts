import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { readChangedSections } from "../evidenceLibraries/configurationSnapshot";
import { isVersionOperation } from "../evidenceLibraries/operationKinds";
import { internalMutation } from "../lib/functions";

/**
 * Records, on each version made before versions recorded it themselves (#423), the sections
 * its revision changed, so the Versions list reads no configuration. A version recorded since
 * carries them from the start, and one already filled is left alone however often this runs.
 *
 *   npx convex run migrations/versionChangedSections:run '{"dryRun": true}'
 *   npx convex run migrations/versionChangedSections:run
 *   npx convex run migrations/versionChangedSections:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** The revision of a version that names its changed sections and doesn't yet: a software update names none. */
async function unrecorded(ctx: QueryCtx, operation: Doc<"evidenceLibraryConfigOperations">) {
  if (operation.changedSections !== undefined || operation.runtimeUpdate || !isVersionOperation(operation)) return null;
  return await ctx.db.get("evidenceLibraryConfigRevisions", operation.revisionId!);
}

// One at a time: an operation keeps its deployment's encrypted configuration, so its row can
// be near the 1 MiB a document may hold and is read again by the patch and its triggers, and
// each version reads its configuration and the one before it, up to 768 KiB each.
export const operations = migrations.define({
  table: "evidenceLibraryConfigOperations",
  batchSize: 1,
  migrateOne: async (ctx, operation) => {
    const revision = await unrecorded(ctx, operation);
    if (revision) return { changedSections: await readChangedSections(ctx, revision) };
  },
});

export const run = migrations.runner(internal.migrations.versionChangedSections.operations);

/** Versions on one page of operations that should name their changed sections and don't. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("evidenceLibraryConfigOperations").paginate({ cursor, numItems: 50, maximumBytesRead: 4 * 1024 * 1024 });
    // Only a revision's own row is read here, never its sections.
    const revisions = await Promise.all(page.page.map((operation) => unrecorded(ctx, operation)));
    return { wrong: revisions.filter((revision) => revision !== null).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many versions should name their changed sections and don't, a page at a time; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.versionChangedSections.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
