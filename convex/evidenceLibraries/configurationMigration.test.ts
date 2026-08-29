/// <reference types="vite/client" />
import { register as registerMigrations } from "@convex-dev/migrations/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");
const TAG_DRAFT_VERSIONS = "migrations/ownerConfiguration:tagDraftVersions";
const TAG_REVISION_VERSIONS =
  "migrations/ownerConfiguration:tagRevisionVersions";

type AuditPage = {
  counts: {
    scanned: number;
    missingVersions: number;
    staleFeatures: number;
    nonBooleanExports: number;
    brokenParents: number;
    migrationValidationFailures: number;
    placeholderRevisions: number;
  };
  samples: unknown[];
  continueCursor: string;
  isDone: boolean;
};

async function seedHeaders(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_owner_configuration_migration",
      name: "Migration Team",
      slug: "migration-team",
      state: "active",
      evidenceLibrariesEnabled: true,
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const libraryId = await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: "Migration Library",
      slug: "migration-library",
      state: "active",
      createdByClerkUserId: "user_migration",
      updatedByClerkUserId: "user_migration",
      createdAt: 2,
      updatedAt: 2,
    });
    const revisionId = await ctx.db.insert("evidenceLibraryConfigRevisions", {
      libraryId,
      ownerConfigurationVersion: 1,
      revisionKey: "r1",
      revisionNumber: 1,
      basedOnRevisionId: null,
      rollbackOfRevisionId: null,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      createdByClerkUserId: "user_migration",
      createdAt: 3,
    });
    const draftId = await ctx.db.insert("evidenceLibraryConfigDrafts", {
      libraryId,
      ownerConfigurationVersion: 1,
      baseRevisionId: revisionId,
      editVersion: 4,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      createdByClerkUserId: "user_migration",
      updatedByClerkUserId: "user_migration",
      createdAt: 3,
      updatedAt: 3,
    });
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "draft",
      libraryId,
      draftId,
      sectionKey: "features",
      payload: { ai: false, aiSearch: true, deepResearch: false },
      payloadByteLength: 49,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      updatedByClerkUserId: "user_migration",
      updatedAt: 3,
    });
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "draft",
      libraryId,
      draftId,
      sectionKey: "exports",
      payload: { ris: "https://feeds.example.test/library.ris" },
      payloadByteLength: 51,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      updatedByClerkUserId: "user_migration",
      updatedAt: 3,
    });
    return { draftId, libraryId, revisionId };
  });
}

async function readAuditPages(
  t: ReturnType<typeof convexTest>,
): Promise<AuditPage[]> {
  const pages: AuditPage[] = [];
  let cursor: string | null = null;
  do {
    const page: AuditPage = await t.query(
      internal.evidenceLibraries.configurationMigration.auditPage,
      { paginationOpts: { numItems: 10, cursor } },
    );
    pages.push(page);
    cursor = page.continueCursor || null;
    if (page.isDone) break;
  } while (pages.length < 10);
  return pages;
}

function runTagMigration(t: ReturnType<typeof convexTest>, fn: string) {
  return t.mutation(internal.migrations.ownerConfiguration.run, {
    fn,
    batchSize: 10,
    dryRun: false,
  });
}

describe("Evidence Library configuration migration", () => {
  it("leaves explicitly versioned draft and revision headers alone", async () => {
    const t = convexTest(schema, modules);
    registerMigrations(t);
    const seeded = await seedHeaders(t);
    const beforeRows = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("evidenceLibraryConfigSections")
          .withIndex("by_draftId_and_sectionKey", (query) =>
            query.eq("draftId", seeded.draftId),
          )
          .collect()
      ).map((row) => ({
        sectionKey: row.sectionKey,
        payload: row.payload,
        payloadByteLength: row.payloadByteLength,
      })),
    );
    await runTagMigration(t, TAG_DRAFT_VERSIONS);
    await runTagMigration(t, TAG_REVISION_VERSIONS);
    const tagged = await t.run(async (ctx) => ({
      draft: await ctx.db.get(seeded.draftId),
      revision: await ctx.db.get(seeded.revisionId),
    }));
    expect(tagged.draft?.ownerConfigurationVersion).toBe(1);
    expect(tagged.revision?.ownerConfigurationVersion).toBe(1);

    await runTagMigration(t, TAG_DRAFT_VERSIONS);
    await runTagMigration(t, TAG_REVISION_VERSIONS);
    const unchanged = await t.run(async (ctx) => ({
      draft: await ctx.db.get(seeded.draftId),
      revision: await ctx.db.get(seeded.revisionId),
      rows: await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query.eq("draftId", seeded.draftId),
        )
        .collect(),
    }));
    expect(unchanged.draft?.editVersion).toBe(4);
    expect(unchanged.draft?.ownerConfigurationVersion).toBe(1);
    expect(
      unchanged.rows.map((row) => ({
        sectionKey: row.sectionKey,
        payload: row.payload,
        payloadByteLength: row.payloadByteLength,
      })),
    ).toEqual(beforeRows);
  });

  it("counts a tagged header-only revision as a setup placeholder", async () => {
    const t = convexTest(schema, modules);
    registerMigrations(t);
    const seeded = await seedHeaders(t);
    await runTagMigration(t, TAG_REVISION_VERSIONS);

    const pages = await readAuditPages(t);
    const counts = pages.reduce(
      (total, page) => ({
        migrationValidationFailures:
          total.migrationValidationFailures +
          page.counts.migrationValidationFailures,
        placeholderRevisions:
          total.placeholderRevisions + page.counts.placeholderRevisions,
      }),
      { migrationValidationFailures: 0, placeholderRevisions: 0 },
    );

    expect(pages.at(-1)?.isDone).toBe(true);
    expect(counts.placeholderRevisions).toBe(1);
    expect(counts.migrationValidationFailures).toBe(0);
    expect(
      (await t.run(async (ctx) => ctx.db.get(seeded.revisionId)))
        ?.ownerConfigurationVersion,
    ).toBe(1);
  });

  it("does not flag a tagged draft when version one omits Identity assets", async () => {
    const t = convexTest(schema, modules);
    registerMigrations(t);
    const seeded = await seedHeaders(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryConfigSections", {
        kind: "draft",
        libraryId: seeded.libraryId,
        draftId: seeded.draftId,
        sectionKey: "identity",
        payload: {
          name: "Migration Library",
          shortName: "Migration",
          baseUrl: "https://migration.example.test",
        },
        payloadByteLength: 120,
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        updatedByClerkUserId: "user_migration",
        updatedAt: 3,
      });
    });
    await runTagMigration(t, TAG_DRAFT_VERSIONS);

    const pages = await readAuditPages(t);
    const migrationValidationFailures = pages.reduce(
      (total, page) => total + page.counts.migrationValidationFailures,
      0,
    );
    expect(migrationValidationFailures).toBe(0);
  });

  it("reports bounded findings while paging drafts, revisions, and orphan rows", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedHeaders(t);
    const otherLibraryId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_other_migration",
        name: "Other Migration Team",
        slug: "other-migration-team",
        state: "active",
        evidenceLibrariesEnabled: true,
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("evidenceLibraries", {
        organizationId,
        name: "Other Migration Library",
        slug: "other-migration-library",
        state: "active",
        createdByClerkUserId: "user_migration",
        updatedByClerkUserId: "user_migration",
        createdAt: 2,
        updatedAt: 2,
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("evidenceLibraryConfigSections", {
        kind: "draft",
        libraryId: otherLibraryId,
        draftId: seeded.draftId,
        sectionKey: "features",
        payload: {},
        payloadByteLength: 2,
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        updatedByClerkUserId: "user_migration",
        updatedAt: 4,
      });
    });

    const pages = await readAuditPages(t);

    expect(pages.at(-1)?.isDone).toBe(true);
    const counts = pages.reduce(
      (total, page) => ({
        scanned: total.scanned + page.counts.scanned,
        missingVersions: total.missingVersions + page.counts.missingVersions,
        staleFeatures: total.staleFeatures + page.counts.staleFeatures,
        nonBooleanExports:
          total.nonBooleanExports + page.counts.nonBooleanExports,
        brokenParents: total.brokenParents + page.counts.brokenParents,
        migrationValidationFailures:
          total.migrationValidationFailures +
          page.counts.migrationValidationFailures,
        placeholderRevisions:
          total.placeholderRevisions + page.counts.placeholderRevisions,
      }),
      {
        scanned: 0,
        missingVersions: 0,
        staleFeatures: 0,
        nonBooleanExports: 0,
        brokenParents: 0,
        migrationValidationFailures: 0,
        placeholderRevisions: 0,
      },
    );
    expect(counts.missingVersions).toBe(0);
    expect(counts.staleFeatures).toBe(2);
    expect(counts.nonBooleanExports).toBe(1);
    expect(counts.brokenParents).toBe(1);
    expect(counts.migrationValidationFailures).toBe(2);
    expect(counts.placeholderRevisions).toBe(1);
    expect(pages.every((page) => page.samples.length <= 20)).toBe(true);
  });
});
