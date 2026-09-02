import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import {
  loadDraftConfigurationSnapshot,
  persistDraftConfigurationSnapshot,
} from "../evidenceLibraries/configurationSnapshot";

const migrations = new Migrations<DataModel>(components.migrations);

export const migrateDrafts = migrations.define({
  table: "evidenceLibraryConfigDrafts",
  batchSize: 10,
  migrateOne: async (ctx, draft) => {
    if (draft.ownerConfigurationVersion === 4) return;
    const library = await ctx.db.get("evidenceLibraries", draft.libraryId);
    if (!library) {
      throw new Error(`Evidence Library ${draft.libraryId} not found`);
    }
    const requireComplete = library.state !== "provisioning";
    const loaded = await loadDraftConfigurationSnapshot(ctx, draft._id, {
      requireComplete,
      requireDeclaredDefaults: requireComplete,
    });
    await persistDraftConfigurationSnapshot(ctx, loaded);
  },
});

export const run = migrations.runner(
  internal.migrations.migrateEvidenceLibraryDraftsV4.migrateDrafts,
);
