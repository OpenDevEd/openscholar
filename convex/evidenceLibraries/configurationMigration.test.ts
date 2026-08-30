/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { createDraftSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { internal } from "../_generated/api";
import schema from "../schema";
import { auditHeaderVersion } from "./configurationMigration";

const modules = import.meta.glob("/convex/**/*.ts");
type AuditPage = {
  counts: {
    scanned: number;
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

async function seedHeaders(
  t: ReturnType<typeof convexTest>,
  state: "active" | "provisioning" = "active",
) {
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
      state,
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
      ownerConfigurationVersion: 3,
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
      payload: { ai: false },
      payloadByteLength: 12,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      updatedByClerkUserId: "user_migration",
      updatedAt: 3,
    });
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "draft",
      libraryId,
      draftId,
      sectionKey: "exports",
      payload: { atom: false, bibtex: true, ris: true },
      payloadByteLength: 42,
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

describe("Evidence Library configuration migration", () => {
  it("counts a versioned header-only revision as a setup placeholder", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedHeaders(t, "provisioning");

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

  it("reports an unknown version on a header-only revision", async () => {
    expect(auditHeaderVersion(99, true)).toEqual({
      category: "unknownVersion",
      pointer: "/ownerConfigurationVersion",
      message: "Header-only snapshot version is not supported by this code.",
    });
    expect(auditHeaderVersion(1, true)).toBeNull();
  });

  it("audits active drafts for declared rows while allowing provisioning drafts to stay partial", async () => {
    const active = await createDraftSetupFixture("audit-active-completion");
    await active.t.run(async (ctx) => {
      await ctx.db.patch(active.created.libraryId, { state: "active" });
      const payload = { colors: { accent: "#005A9C", tertiary: "#F2A900" } };
      await ctx.db.insert("evidenceLibraryConfigSections", {
        kind: "draft",
        libraryId: active.created.libraryId,
        draftId: active.created.draftId,
        sectionKey: "theme",
        payload,
        payloadByteLength: Buffer.byteLength(JSON.stringify(payload)),
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        updatedByClerkUserId: active.clerkUserId,
        updatedAt: 1,
      });
    });
    const activePages = await readAuditPages(active.t);
    expect(
      activePages.some((page) =>
        page.samples.some(
          (sample) =>
            typeof sample === "object" &&
            sample !== null &&
            "pointer" in sample &&
            sample.pointer === "/ai",
        ),
      ),
    ).toBe(true);

    const provisioning = await createDraftSetupFixture(
      "audit-provisioning-completion",
    );
    const provisioningPages = await readAuditPages(provisioning.t);
    expect(
      provisioningPages.reduce(
        (total, page) => total + page.counts.migrationValidationFailures,
        0,
      ),
    ).toBe(0);
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
      const features = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query.eq("draftId", seeded.draftId).eq("sectionKey", "features"),
        )
        .unique();
      const exports = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query.eq("draftId", seeded.draftId).eq("sectionKey", "exports"),
        )
        .unique();
      if (!features || !exports) throw new Error("Seeded audit rows missing");
      await ctx.db.patch(features._id, {
        payload: { ai: false, aiSearch: true, deepResearch: false },
        payloadByteLength: 49,
      });
      await ctx.db.patch(exports._id, {
        payload: { ris: "https://feeds.example.test/library.ris" },
        payloadByteLength: 51,
      });
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
        staleFeatures: 0,
        nonBooleanExports: 0,
        brokenParents: 0,
        migrationValidationFailures: 0,
        placeholderRevisions: 0,
      },
    );
    expect(counts.staleFeatures).toBe(2);
    expect(counts.nonBooleanExports).toBe(1);
    expect(counts.brokenParents).toBe(1);
    expect(counts.migrationValidationFailures).toBe(1);
    expect(counts.placeholderRevisions).toBe(1);
    expect(pages.every((page) => page.samples.length <= 20)).toBe(true);
  });
});
