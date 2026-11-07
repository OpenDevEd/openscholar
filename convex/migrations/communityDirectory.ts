import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { backfillCard } from "../evidenceLibraries/directory";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Gives every live community its directory card (#1090): its card, when it went live and when the settings it runs
// were published, and a record count, which it otherwise gets at its next publish. Safe to repeat.
// Ten at a time: each reads the settings it runs.
export const cardsFromSettings = migrations.define({ table: "evidenceLibraries", batchSize: 10, migrateOne: (ctx, library) => backfillCard(ctx, library) });

export const run = migrations.runner([internal.migrations.communityDirectory.cardsFromSettings]);
