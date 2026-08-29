import { Migrations } from "@convex-dev/migrations";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

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

export const run = migrations.runner();
