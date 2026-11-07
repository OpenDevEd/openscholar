import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { backfillCard } from "../evidenceLibraries/directory";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Gives every community that was live before the directory kept cards (#1090) its card, when it went
// live and a record count, which it otherwise gets at its next publish. Safe to repeat: one with a card is left alone.
export const cards = migrations.define({ table: "evidenceLibraries", migrateOne: (ctx, library) => backfillCard(ctx, library) });

export const run = migrations.runner([internal.migrations.communityDirectory.cards]);
