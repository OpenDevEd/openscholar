import { Migrations } from "@convex-dev/migrations";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { isRuntimeImageReference } from "../evidenceLibraries/runtimeImageRegistry";
import {
  planRuntimeImageOperationCleanup,
  requireProvisionedRuntimeImage,
} from "../evidenceLibraries/runtimeImageMigration";

const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
  migrationsLocationPrefix: "migrations/runtimeImageReleaseIdentity:",
});

export const run = migrations.runner();

export const deleteCommitOnlyReleaseCache = migrations.define({
  table: "evidenceLibraryRuntimeReleases",
  migrateOne: async (ctx, release) => {
    if (
      typeof release.latestImage !== "string" ||
      !isRuntimeImageReference(release.latestImage)
    ) {
      await ctx.db.delete(release._id);
    }
  },
});

export const cleanTerminalCommitOnlyOperations = migrations.define({
  table: "evidenceLibraryConfigOperations",
  migrateOne: (_ctx, operation) =>
    planRuntimeImageOperationCleanup(operation) ?? undefined,
});

export const verifyProvisionedBindings = migrations.define({
  table: "evidenceLibraryRuntimeBindings",
  migrateOne: (_ctx, binding) => {
    requireProvisionedRuntimeImage(binding);
  },
});
