import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  migrateOwnerConfiguration,
  type OwnerConfigurationMigrationResult,
  type OwnerConfigurationSnapshot,
  type OwnerConfigurationValidationOptions,
} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { SECTION_REGISTRY } from "../../lib/evidence-libraries/configuration/section-registry";

type SnapshotCtx = QueryCtx | MutationCtx;
type SnapshotHeader =
  | Doc<"evidenceLibraryConfigDrafts">
  | Doc<"evidenceLibraryConfigRevisions">;

export type LoadedConfigurationSnapshot = {
  header: SnapshotHeader;
  sections: Doc<"evidenceLibraryConfigSections">[];
  migration: OwnerConfigurationMigrationResult;
};

export function materializeConfigurationSnapshot(
  snapshot: OwnerConfigurationSnapshot,
  options: OwnerConfigurationValidationOptions,
): OwnerConfigurationMigrationResult {
  return migrateOwnerConfiguration(snapshot, options);
}

export async function loadConfigurationSections(
  ctx: SnapshotCtx,
  kind: "draft" | "revision",
  id: Id<"evidenceLibraryConfigDrafts"> | Id<"evidenceLibraryConfigRevisions">,
) {
  const rows =
    kind === "draft"
      ? await ctx.db
          .query("evidenceLibraryConfigSections")
          .withIndex("by_draftId_and_sectionKey", (query) =>
            query.eq("draftId", id as Id<"evidenceLibraryConfigDrafts">),
          )
          .take(SECTION_REGISTRY.length + 1)
      : await ctx.db
          .query("evidenceLibraryConfigSections")
          .withIndex("by_revisionId_and_sectionKey", (query) =>
            query.eq("revisionId", id as Id<"evidenceLibraryConfigRevisions">),
          )
          .take(SECTION_REGISTRY.length + 1);
  for (const row of rows) {
    if (row.kind !== kind) {
      throw new Error(`${kind} section index returned a different row kind`);
    }
  }
  return rows;
}

export async function loadDraftConfigurationSnapshot(
  ctx: SnapshotCtx,
  draftId: Id<"evidenceLibraryConfigDrafts">,
  options: OwnerConfigurationValidationOptions,
): Promise<LoadedConfigurationSnapshot> {
  const header = await ctx.db.get("evidenceLibraryConfigDrafts", draftId);
  if (!header) throw new Error("Evidence Library draft not found");
  const sections = await loadConfigurationSections(ctx, "draft", draftId);
  const snapshot = {
    ownerConfigurationVersion: header.ownerConfigurationVersion,
    sections: sections.map((row) => ({
      sectionKey: row.sectionKey,
      payload: row.payload,
    })),
  } as OwnerConfigurationSnapshot;
  return {
    header,
    sections,
    migration: materializeConfigurationSnapshot(snapshot, options),
  };
}

export async function loadRevisionConfigurationSnapshot(
  ctx: SnapshotCtx,
  revisionId: Id<"evidenceLibraryConfigRevisions">,
  options: OwnerConfigurationValidationOptions,
): Promise<LoadedConfigurationSnapshot> {
  const header = await ctx.db.get("evidenceLibraryConfigRevisions", revisionId);
  if (!header) throw new Error("Evidence Library revision not found");
  const sections = await loadConfigurationSections(ctx, "revision", revisionId);
  const snapshot = {
    ownerConfigurationVersion: header.ownerConfigurationVersion,
    sections: sections.map((row) => ({
      sectionKey: row.sectionKey,
      payload: row.payload,
    })),
  } as OwnerConfigurationSnapshot;
  return {
    header,
    sections,
    migration: materializeConfigurationSnapshot(snapshot, options),
  };
}
