import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  CURRENT_OWNER_CONFIGURATION_VERSION,
  migrateOwnerConfiguration,
  type OwnerConfigurationMigrationResult,
  type OwnerConfigurationSnapshot,
  type OwnerConfigurationValidationOptions,
} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { SECTION_REGISTRY } from "../../lib/evidence-libraries/configuration/section-registry";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { validateSectionPayload } from "./sectionPayload";

type SnapshotCtx = QueryCtx | MutationCtx;
type SnapshotHeader =
  | Doc<"evidenceLibraryConfigDrafts">
  | Doc<"evidenceLibraryConfigRevisions">;

export type LoadedConfigurationSnapshot = {
  header: SnapshotHeader;
  sections: Doc<"evidenceLibraryConfigSections">[];
  migration: OwnerConfigurationMigrationResult;
};

export type PersistDraftConfigurationOptions = {
  updatedByClerkUserId?: string;
  updatedAt?: number;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function configurationSectionFingerprints(
  snapshot: OwnerConfigurationSnapshot,
) {
  return new Map(
    snapshot.sections.map((row) => [
      row.sectionKey,
      stableJson(row.payload),
    ]),
  );
}

/** Whether two migrated configuration snapshots would publish the same rows. */
export function configurationSnapshotsEqual(
  left: OwnerConfigurationSnapshot,
  right: OwnerConfigurationSnapshot,
): boolean {
  const leftRows = configurationSectionFingerprints(left);
  const rightRows = configurationSectionFingerprints(right);
  if (leftRows.size !== rightRows.size) return false;
  return [...leftRows].every(
    ([sectionKey, fingerprint]) =>
      rightRows.get(sectionKey) === fingerprint,
  );
}

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

function samePayload(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Stores a migrated draft in the same transaction as the caller's mutation.
 * Revisions stay frozen, so this helper deliberately accepts drafts only.
 */
export async function persistDraftConfigurationSnapshot(
  ctx: MutationCtx,
  loaded: LoadedConfigurationSnapshot,
  options: PersistDraftConfigurationOptions = {},
): Promise<void> {
  if (!("editVersion" in loaded.header)) {
    throw new Error("Only draft configuration snapshots can be persisted");
  }

  const draft = loaded.header as Doc<"evidenceLibraryConfigDrafts">;
  const migratedSnapshot = loaded.migration.snapshot;
  const storedRows = loaded.sections.filter((row) => row.kind === "draft");
  const rowsByKey = new Map(storedRows.map((row) => [row.sectionKey, row]));
  const nextKeys = new Set(
    migratedSnapshot.sections.map((row) => row.sectionKey),
  );
  const rowsChanged =
    migratedSnapshot.sections.some((row) => {
      const existing = rowsByKey.get(row.sectionKey);
      return !existing || !samePayload(existing.payload, row.payload);
    }) || storedRows.some((row) => !nextKeys.has(row.sectionKey));
  const headerChanged =
    draft.ownerConfigurationVersion !==
      migratedSnapshot.ownerConfigurationVersion ||
    options.updatedByClerkUserId !== undefined ||
    options.updatedAt !== undefined;
  if (!rowsChanged && !headerChanged) return;
  const updatedAt = options.updatedAt ?? draft.updatedAt;
  const updatedBy = options.updatedByClerkUserId ?? draft.updatedByClerkUserId;

  for (const row of migratedSnapshot.sections) {
    const existing = rowsByKey.get(row.sectionKey);
    const payloadByteLength = validateSectionPayload(row.payload);
    if (existing && samePayload(existing.payload, row.payload)) continue;
    const fields = {
      kind: "draft" as const,
      libraryId: draft.libraryId,
      draftId: draft._id,
      sectionKey: row.sectionKey,
      payload: row.payload,
      payloadByteLength,
      contractProvenance:
        existing?.contractProvenance ?? EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      // A migration changes the stored shape, not who last edited the
      // setting. A save may update the draft header at the same time, but
      // each migrated row keeps its own audit actor and timestamp.
      updatedByClerkUserId: existing?.updatedByClerkUserId ?? updatedBy,
      updatedAt: existing?.updatedAt ?? updatedAt,
    };
    if (existing) {
      await ctx.db.replace(
        "evidenceLibraryConfigSections",
        existing._id,
        fields,
      );
    } else {
      await ctx.db.insert("evidenceLibraryConfigSections", fields);
    }
  }

  for (const row of storedRows) {
    if (!nextKeys.has(row.sectionKey)) {
      await ctx.db.delete(row._id);
    }
  }

  await ctx.db.patch(draft._id, {
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    ...(options.updatedByClerkUserId === undefined
      ? {}
      : { updatedByClerkUserId: options.updatedByClerkUserId }),
    ...(options.updatedAt === undefined
      ? {}
      : { updatedAt: options.updatedAt }),
  });
}
