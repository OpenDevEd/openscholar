import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { backfillCard } from "../evidenceLibraries/directory";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Gives every community that was live before the directory kept cards (#1090) its card, when it went live,
// when it last published and a record count, which it otherwise gets at its next publish. Safe to repeat.
// Ten at a time: each reads its deployment record and the settings it runs, which together can near a megabyte.
export const cards = migrations.define({ table: "evidenceLibraries", batchSize: 10, migrateOne: (ctx, library) => backfillCard(ctx, library) });

// The same again for communities whose cards came before a card kept its description and its last publish (#1090):
// it reads each one's card again from the version it runs. One with a last publish is left alone.
export const published = migrations.define({ table: "evidenceLibraries", batchSize: 10, migrateOne: (ctx, library) => backfillCard(ctx, library) });

export const run = migrations.runner([internal.migrations.communityDirectory.cards, internal.migrations.communityDirectory.published]);
