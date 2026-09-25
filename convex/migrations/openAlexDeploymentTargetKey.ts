import { Migrations } from "@convex-dev/migrations";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
  migrationsLocationPrefix: "migrations/openAlexDeploymentTargetKey:",
});

export const run = migrations.runner();

/**
 * Deployment targets saved before OpenAlex sources were built without an
 * OpenAlex key, so they record that no key was present.
 */
export const backfillOpenAlexKeySource = migrations.define({
  table: "evidenceLibraryConfigOperations",
  migrateOne: (_ctx, operation) => {
    const target = operation.configurationDeploymentTarget;
    if (!target || target.openAlexApiKey) return;
    return {
      configurationDeploymentTarget: {
        ...target,
        openAlexApiKey: { present: false as const },
      },
    };
  },
});
