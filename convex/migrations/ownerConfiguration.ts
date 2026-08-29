import { Migrations } from "@convex-dev/migrations";
import type { ComponentApi } from "@convex-dev/migrations/_generated/component.js";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { SECTION_REGISTRY } from "../../lib/evidence-libraries/configuration/section-registry";
import {
  migrateOwnerConfiguration,
  type OwnerConfigurationSnapshot,
} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { validateSectionPayload } from "../evidenceLibraries/sectionPayload";

const migrationComponent = (
  components as typeof components & {
    migrations: ComponentApi<"migrations">;
  }
).migrations;

export const migrations = new Migrations<DataModel>(migrationComponent, {
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

type DraftSection = Doc<"evidenceLibraryConfigSections"> & {
  kind: "draft";
};

async function readDraftSections(
  ctx: MutationCtx,
  draftId: Id<"evidenceLibraryConfigDrafts">,
): Promise<DraftSection[]> {
  const rows = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draftId),
    )
    .take(SECTION_REGISTRY.length + 1);
  for (const row of rows) {
    if (row.kind !== "draft") {
      throw new Error("Draft section index returned a revision row");
    }
  }
  return rows as DraftSection[];
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const migrateDraftsToV2 = migrations.define({
  table: "evidenceLibraryConfigDrafts",
  batchSize: 1,
  migrateOne: async (ctx, draft) => {
    const storedVersion = draft.ownerConfigurationVersion as number | undefined;
    if (storedVersion === 2) return;
    const rows = await readDraftSections(ctx, draft._id);
    const snapshot: OwnerConfigurationSnapshot = {
      ownerConfigurationVersion: storedVersion as number,
      sections: rows.map((row) => ({
        sectionKey: row.sectionKey,
        payload: row.payload,
      })),
    };
    const migrated = migrateOwnerConfiguration(snapshot, {
      requireComplete: false,
    });
    const now = Date.now();
    const nextByKey = new Map(
      migrated.snapshot.sections.map((section) => [
        section.sectionKey,
        section.payload,
      ]),
    );
    for (const row of rows) {
      const payload = nextByKey.get(row.sectionKey);
      if (payload === undefined) {
        await ctx.db.delete(row._id);
        continue;
      }
      if (sameJson(row.payload, payload)) continue;
      await ctx.db.replace("evidenceLibraryConfigSections", row._id, {
        kind: "draft",
        libraryId: row.libraryId,
        draftId: row.draftId,
        sectionKey: row.sectionKey,
        payload,
        payloadByteLength: validateSectionPayload(payload),
        contractProvenance: row.contractProvenance,
        updatedByClerkUserId: row.updatedByClerkUserId,
        updatedAt: now,
      });
    }
    for (const section of migrated.snapshot.sections) {
      if (rows.some((row) => row.sectionKey === section.sectionKey)) continue;
      await ctx.db.insert("evidenceLibraryConfigSections", {
        kind: "draft",
        libraryId: draft.libraryId,
        draftId: draft._id,
        sectionKey: section.sectionKey,
        payload: section.payload,
        payloadByteLength: validateSectionPayload(section.payload),
        contractProvenance: draft.contractProvenance,
        updatedByClerkUserId: draft.updatedByClerkUserId,
        updatedAt: now,
      });
    }
    // Deploy A accepts only the backfill literal. Deploy B widens this field
    // to 1 | 2 before this migration is run.
    await ctx.db.patch(draft._id, {
      ownerConfigurationVersion: 2 as never,
    });
  },
});
