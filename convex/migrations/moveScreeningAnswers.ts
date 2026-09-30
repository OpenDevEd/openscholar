import { Migrations } from "@convex-dev/migrations";
import { internalMutation } from "../lib/functions";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";
import { moveSearchAnswers, verifyMovedAnswers } from "../research/records";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/**
 * Moves page-screening answers out of the chunks on saved searches and their revisions,
 * into answer rows and their history (#334). It walks revisions, so deleted searches are
 * covered, and each search moves once. A search that is edited before this reaches it
 * moves on that edit.
 *
 *   npx convex run migrations/moveScreeningAnswers:run '{"dryRun": true}'
 *   npx convex run migrations/moveScreeningAnswers:run
 *   npx convex run migrations/moveScreeningAnswers:verify
 *
 * Chunks stay readable until `verify` reports no mismatches and nothing waiting on the
 * live deployment; a later change removes them.
 *
 * ponytail: each search moves in one transaction and `verify` is one query. Chunk storage only
 * ever ran on dev (2026-09-30: 31 revisions and one chunk on shared dev), far inside both;
 * a deployment with large screenings would need the move split per revision.
 */
export const moveAnswers = migrations.define({
  table: "searchRevisions",
  migrateOne: async (ctx, revision) => {
    await moveSearchAnswers(ctx, revision.searchId, revision.userId);
  },
});

export const run = migrations.runner(internal.migrations.moveScreeningAnswers.moveAnswers);

export const verify = internalQuery({
  args: {},
  returns: v.object({ revisions: v.number(), waiting: v.number(), mismatches: v.array(v.string()) }),
  handler: (ctx) => verifyMovedAnswers(ctx),
});
