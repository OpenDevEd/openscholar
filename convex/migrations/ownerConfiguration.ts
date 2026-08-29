import { Migrations } from "@convex-dev/migrations";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import {
  loadDraftConfigurationSnapshot,
  persistDraftConfigurationSnapshot,
} from "../evidenceLibraries/configurationSnapshot";

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
});

export const tagDraftVersions = migrations.define({
  table: "evidenceLibraryConfigDrafts",
  migrateOne: (_ctx, draft) =>
    draft.ownerConfigurationVersion === undefined
      ? { ownerConfigurationVersion: 1 as const }
      : undefined,
});

export const tagRevisionVersions = migrations.define({
  table: "evidenceLibraryConfigRevisions",
  migrateOne: (_ctx, revision) =>
    revision.ownerConfigurationVersion === undefined
      ? { ownerConfigurationVersion: 1 as const }
      : undefined,
});

// Drafts are migrated one at a time so each section rewrite and its header
// version commit atomically in one Convex transaction.
export const migrateDraftsToV2 = migrations.define({
  table: "evidenceLibraryConfigDrafts",
  batchSize: 1,
  migrateOne: async (ctx, draft) => {
    const loaded = await loadDraftConfigurationSnapshot(ctx, draft._id, {
      requireComplete: false,
    });
    await persistDraftConfigurationSnapshot(ctx, loaded);
  },
});

export const run = migrations.runner();
