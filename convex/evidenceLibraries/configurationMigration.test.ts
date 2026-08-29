/// <reference types="vite/client" />
import { register as registerMigrations } from "@convex-dev/migrations/test";
import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");

type AuditPage = {
  counts: {
    scanned: number;
    missingVersions: number;
    staleFeatures: number;
    nonBooleanExports: number;
    brokenParents: number;
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

describe("Evidence Library configuration migration", () => {
  it("tags missing draft and revision headers and leaves tagged headers alone", async () => {
    const t = convexTest(schema, modules);
    registerMigrations(t);
    const seeded = await seedHeaders(t);
    const args = {
      cursor: null,
      batchSize: 10,
      dryRun: false,
      oneBatchOnly: true,
    };
    await t.mutation(anyApi.migrations.ownerConfiguration.tagDraftVersions, args);
    await t.mutation(anyApi.migrations.ownerConfiguration.tagRevisionVersions, args);
    const tagged = await t.run(async (ctx) => ({
      draft: await ctx.db.get(seeded.draftId),
      revision: await ctx.db.get(seeded.revisionId),
    }));
    expect(tagged.draft?.ownerConfigurationVersion).toBe(1);
    expect(tagged.revision?.ownerConfigurationVersion).toBe(1);

    await t.mutation(anyApi.migrations.ownerConfiguration.tagDraftVersions, args);
    await t.mutation(anyApi.migrations.ownerConfiguration.tagRevisionVersions, args);
    const unchanged = await t.run(async (ctx) => ({
      draft: await ctx.db.get(seeded.draftId),
      revision: await ctx.db.get(seeded.revisionId),
    }));
    expect(unchanged.draft?.editVersion).toBe(4);
    expect(unchanged.draft?.ownerConfigurationVersion).toBe(1);
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

    const pages: AuditPage[] = [];
    let cursor: string | null = null;
    do {
      const page: AuditPage = await t.query(
        anyApi.evidenceLibraries.configurationMigration.auditPage,
        { paginationOpts: { numItems: 10, cursor } },
      );
      pages.push(page);
      cursor = page.continueCursor || null;
      if (page.isDone) break;
    } while (pages.length < 10);

    expect(pages.at(-1)?.isDone).toBe(true);
    const counts = pages.reduce(
      (total, page) => ({
        scanned: total.scanned + page.counts.scanned,
        missingVersions: total.missingVersions + page.counts.missingVersions,
        staleFeatures: total.staleFeatures + page.counts.staleFeatures,
        nonBooleanExports: total.nonBooleanExports + page.counts.nonBooleanExports,
        brokenParents: total.brokenParents + page.counts.brokenParents,
      }),
      {
        scanned: 0,
        missingVersions: 0,
        staleFeatures: 0,
        nonBooleanExports: 0,
        brokenParents: 0,
      },
    );
    expect(counts.missingVersions).toBe(2);
    expect(counts.staleFeatures).toBe(2);
    expect(counts.nonBooleanExports).toBe(1);
    expect(counts.brokenParents).toBe(1);
    expect(pages.every((page) => page.samples.length <= 20)).toBe(true);
  });
});
