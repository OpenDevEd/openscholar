import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { backfillCard } from "../evidenceLibraries/directory";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Gives every live community its directory card (#1090): its card, when it went live and when its owners last put
// their settings live, and a record count, which it otherwise gets at its next publish. Safe to repeat.
// A few at a time: each reads up to ten of its operations, and one can be over 100 kB.
export const cardsFromPublishes = migrations.define({ table: "evidenceLibraries", batchSize: 5, migrateOne: (ctx, library) => backfillCard(ctx, library) });

// The same again for cards kept before they had the lower-case name the directory sorts by.
export const cardNameKeys = migrations.define({ table: "evidenceLibraries", batchSize: 5, migrateOne: (ctx, library) => backfillCard(ctx, library) });

export const run = migrations.runner([internal.migrations.communityDirectory.cardsFromPublishes, internal.migrations.communityDirectory.cardNameKeys]);
