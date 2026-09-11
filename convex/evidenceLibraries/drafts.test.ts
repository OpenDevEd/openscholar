import { seedFeatureUser } from "../organizationFeatures.test-support";
import { assert } from "vitest";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { createEvidenceLibrarySetup } from "./mutations";
import {
  readEvidenceLibraries,
  readEvidenceLibraryDraft,
  readEvidenceLibraryRevision,
} from "./queries";
import {
  createDraftSetupFixture,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";

const modules = import.meta.glob("/convex/**/*.ts");

function configurationSections(baseUrl: string, name: string) {
  return {
    identity: {
      baseUrl,
      name,
      shortName: name,
      tagline: "Evidence for climate decisions",
      description: "A curated library of climate research.",
      assets: {
        logoDark: "https://assets.example.org/library-logo.svg",
        favicon: "https://assets.example.org/library-favicon.ico",
        shareImage: "https://assets.example.org/library-share.png",
      },
    },
    theme: { colors: { accent: "#005A9C", tertiary: "#F2A900" } },
    localization: { locales: ["en-GB", "fr"], defaultLocale: "en-GB" },
    footer: { poweredBy: true },
  };
}

describe("Evidence Library draft storage", () => {
  it("projects rollout drafts as current while keeping v1 revisions historical", async () => {
    const fixture = await createDraftSetupFixture("draft-version-contract");

    const currentDraft = await fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId: fixture.created.libraryId },
    );
    assert(currentDraft, "Expected an accessible draft");
    const currentRevision = await fixture.admin.query(
      api.evidenceLibraries.queries.getRevision,
      {
        libraryId: fixture.created.libraryId,
        revisionId: fixture.created.revisionId,
      },
    );
    expect(currentDraft.draft.ownerConfigurationVersion).toBe(5);
    expect(currentRevision.revision.ownerConfigurationVersion).toBe(5);

    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.created.draftId, {
        ownerConfigurationVersion: 3,
      });
      const rows = await ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_draftId_and_sectionKey", (query) =>
          query.eq("draftId", fixture.created.draftId),
        )
        .collect();
      for (const sectionKey of ["features", "search"] as const) {
        const existing = rows.find((row) => row.sectionKey === sectionKey);
        const payload =
          sectionKey === "features"
            ? {
                ...((existing?.payload as object | undefined) ?? {}),
                authorLocation: true,
              }
            : {
                ...((existing?.payload as object | undefined) ?? {}),
                authorCountry: true,
              };
        const payloadByteLength = Buffer.byteLength(JSON.stringify(payload));
        if (existing) {
          await ctx.db.patch(existing._id, { payload, payloadByteLength });
        } else {
          await ctx.db.insert("evidenceLibraryConfigSections", {
            kind: "draft",
            libraryId: fixture.created.libraryId,
            draftId: fixture.created.draftId,
            sectionKey,
            payload,
            payloadByteLength,
            contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
            updatedByClerkUserId: "user_rollout_migration",
            updatedAt: 4,
          });
        }
      }
    });
    const rolloutDraft = await fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId: fixture.created.libraryId },
    );
    assert(rolloutDraft, "Expected an accessible draft");
    const storedRolloutDraft = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.draftId),
    );
    expect(rolloutDraft.draft.ownerConfigurationVersion).toBe(5);
    expect(storedRolloutDraft?.ownerConfigurationVersion).toBe(3);
    expect(
      rolloutDraft.sections.find((row) => row.sectionKey === "features")
        ?.payload,
    ).not.toHaveProperty("authorLocation");
    expect(
      rolloutDraft.sections.find((row) => row.sectionKey === "search")?.payload,
    ).not.toHaveProperty("authorCountry");

    await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: fixture.created.libraryId,
        sections: [{ sectionKey: "footer", payload: { poweredBy: true } }],
        expectedEditVersion: rolloutDraft.draft.editVersion,
      },
    );
    const migratedDraft = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.draftId),
    );
    expect(migratedDraft?.ownerConfigurationVersion).toBe(5);

    await expect(
      fixture.t.run((ctx) =>
        ctx.db.patch(fixture.created.draftId, {
          ownerConfigurationVersion: 1 as never,
        }),
      ),
    ).rejects.toThrow();

    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.created.revisionId, {
        ownerConfigurationVersion: 1,
      }),
    );
    const historicalRevision = await fixture.admin.query(
      api.evidenceLibraries.queries.getRevision,
      {
        libraryId: fixture.created.libraryId,
        revisionId: fixture.created.revisionId,
      },
    );
    expect(historicalRevision.revision.ownerConfigurationVersion).toBe(1);
  });

  it("stores one provenance-locked draft with section rows", async () => {
    const t = convexTest(schema, modules);
    const stored = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_123",
        name: "Evidence Team",
        slug: "evidence-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        evidenceLibrariesEnabled: true,
      });
      const libraryId = await ctx.db.insert("evidenceLibraries", {
        organizationId,
        name: "Climate Evidence",
        slug: "climate-evidence",
        state: "active",
        createdByClerkUserId: "user_123",
        updatedByClerkUserId: "user_123",
        createdAt: 2,
        updatedAt: 2,
      });
      const draftId = await ctx.db.insert("evidenceLibraryConfigDrafts", {
        libraryId,
        baseRevisionId: null,
        editVersion: 0,
        ownerConfigurationVersion: 3,
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        createdByClerkUserId: "user_123",
        updatedByClerkUserId: "user_123",
        createdAt: 3,
        updatedAt: 3,
      });
      const identityPayload = {
        baseUrl: "https://climate-evidence.example.org",
        name: "Climate Evidence",
        shortName: "Climate Evidence",
      };
      await ctx.db.insert("evidenceLibraryConfigSections", {
        kind: "draft",
        libraryId,
        draftId,
        sectionKey: "identity",
        payload: identityPayload,
        payloadByteLength: Buffer.byteLength(JSON.stringify(identityPayload)),
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        updatedByClerkUserId: "user_123",
        updatedAt: 3,
      });
      return await ctx.db
        .query("evidenceLibraryConfigDrafts")
        .withIndex("by_libraryId", (query) => query.eq("libraryId", libraryId))
        .unique();
    });

    expect(stored).toMatchObject({
      editVersion: 0,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    });
  });

  it("rejects incomplete identity saves and changes to the reserved address", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_identity_contract",
        name: "Identity Team",
        slug: "identity-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        evidenceLibrariesEnabled: true,
      });
      await seedFeatureUser(ctx, "user_identity_contract");
    await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_identity_contract",
        clerkUserId: "user_identity_contract",
        role: "org:admin",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const admin = t.withIdentity({
      subject: "user_identity_contract",
      o: { id: "org_identity_contract", rol: "org:admin" },
    });
    const created = await admin.run(async (ctx) =>
      createEvidenceLibrarySetup(ctx, { organizationId: (await admin.query(api.organizationFeatures.libraryOrganizations, {}))[0]!.id,
        name: "Identity Library",
        slug: "identity-library",
        publicAddress: "https://identity-library.example.org",
      }),
    );
    const validSections = configurationSections(
      "https://identity-library.example.org",
      "Identity Library",
    );

    await expect(
      admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: toSectionRows({
          ...validSections,
          identity: {
            ...validSections.identity,
            assets: { ...validSections.identity.assets, logoDark: "" },
          },
        }),
        expectedEditVersion: 0,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR.*\/identity\/assets\/logoDark/);
    await expect(
      admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: toSectionRows({
          ...validSections,
          identity: {
            ...validSections.identity,
            baseUrl: "https://changed-address.example.org",
          },
        }),
        expectedEditVersion: 0,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR.*\/identity\/baseUrl/);

    const stored = await admin.run((ctx) =>
      readEvidenceLibraryDraft(ctx, { libraryId: created.libraryId }),
    );
    assert(stored);
    expect(stored.draft.editVersion).toBe(0);
    expect(stored.sections).toEqual([
      expect.objectContaining({
        sectionKey: "identity",
        payload: {
          assets: {},
          baseUrl: "https://identity-library.example.org",
          name: "Identity Library",
          shortName: "Identity Library",
        },
      }),
      expect.objectContaining({
        sectionKey: "localization",
        payload: { locales: ["en-GB"], defaultLocale: "en-GB" },
      }),
    ]);
  });

  it("saves any registry section, rejects a payload that breaks its slice, and keeps secrets out", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_generic_sections",
        name: "Generic Team",
        slug: "generic-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        evidenceLibrariesEnabled: true,
      });
      await seedFeatureUser(ctx, "user_generic_sections");
    await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_generic_sections",
        clerkUserId: "user_generic_sections",
        role: "org:admin",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const admin = t.withIdentity({
      subject: "user_generic_sections",
      o: { id: "org_generic_sections", rol: "org:admin" },
    });
    const created = await admin.run(async (ctx) =>
      createEvidenceLibrarySetup(ctx, { organizationId: (await admin.query(api.organizationFeatures.libraryOrganizations, {}))[0]!.id,
        name: "Generic Library",
        slug: "generic-library",
        publicAddress: "https://generic-library.example.org",
      }),
    );
    const navigation = {
      links: [{ id: "home", label: "Home", href: "/", target: "blank" }],
    };
    const footer = {
      poweredBy: true,
      disclaimer: "Views are the authors' own.",
    };

    const saved = await admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: created.libraryId,
        sections: [
          { sectionKey: "navigation", payload: navigation },
          { sectionKey: "footer", payload: footer },
        ],
        expectedEditVersion: 0,
      },
    );
    const reloaded = await admin.query(api.evidenceLibraries.queries.getDraft, {
      libraryId: created.libraryId,
    });
    assert(reloaded, "Expected an accessible draft");

    expect(saved.editVersion).toBe(1);
    expect(reloaded.operation).toMatchObject({
      kind: "setup",
      status: "queued",
    });
    expect(
      Object.fromEntries(
        reloaded.sections.map((section) => [
          section.sectionKey,
          section.payload,
        ]),
      ),
    ).toMatchObject({ navigation, footer });

    await expect(
      admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: [
          {
            sectionKey: "navigation",
            payload: {
              links: [
                { id: "home", label: "Home", href: "/", target: "popup" },
              ],
            },
          },
        ],
        expectedEditVersion: 1,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR.*\/navigation\/links\/0\/target/);
    await expect(
      admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: [
          {
            sectionKey: "sources",
            payload: [
              {
                key: "main",
                provider: "zotero",
                groupId: "123",
                apiKey: "secret",
              },
            ],
          },
        ],
        expectedEditVersion: 1,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR.*\/sources/);
    await expect(
      admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: [
          { sectionKey: "footer", payload: footer },
          { sectionKey: "services", payload: { publication: {} } },
        ],
        expectedEditVersion: 1,
      }),
    ).rejects.toThrow(
      /VALIDATION_ERROR.*\/services: This section is set by the platform/,
    );
    await expect(
      admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: [{ sectionKey: "footer", payload: footer }],
        expectedEditVersion: 0,
      }),
    ).rejects.toThrow(/CONFLICT.*Draft changed since it was loaded/);
    // The identity row has no logo; the platform fills that, so the first
    // thing activation misses is the required theme row.
    await expect(
      admin.mutation(api.evidenceLibraries.mutations.activateConfiguration, {
        libraryId: created.libraryId,
        expectedEditVersion: 1,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR.*\/theme: Required section is missing/);

    const unchanged = await admin.run((ctx) =>
      readEvidenceLibraryDraft(ctx, { libraryId: created.libraryId }),
    );
    assert(unchanged);
    expect(unchanged.draft.editVersion).toBe(1);
    expect(
      unchanged.sections.map((section) => section.sectionKey).sort(),
    ).toEqual(["footer", "identity", "localization", "navigation"]);
  });

  it("creates, saves, reloads, and rejects a stale draft edit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_123",
        name: "Evidence Team",
        slug: "evidence-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        evidenceLibrariesEnabled: true,
      });
      await seedFeatureUser(ctx, "user_admin");
    await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_admin",
        clerkUserId: "user_admin",
        role: "org:admin",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await seedFeatureUser(ctx, "user_member");
    await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_member",
        clerkUserId: "user_member",
        role: "org:member",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const asAdmin = t.withIdentity({
      subject: "user_admin",
      o: { id: "org_123", rol: "org:admin" },
    });
    const asMember = t.withIdentity({
      subject: "user_member",
      o: { id: "org_123", rol: "org:member" },
    });

    const created = await asAdmin.run(async (ctx) =>
      createEvidenceLibrarySetup(ctx, { organizationId: (await asAdmin.query(api.organizationFeatures.libraryOrganizations, {}))[0]!.id,
        name: "Climate Evidence",
        slug: "climate-evidence",
        publicAddress: "https://climate-evidence.example.org",
      }),
    );
    const sections = configurationSections(
      "https://climate-evidence.example.org",
      "Climate Evidence",
    );
    const saved = await asAdmin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: created.libraryId,
        sections: toSectionRows(sections),
        expectedEditVersion: 0,
      },
    );
    const reloaded = await asAdmin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId: created.libraryId },
    );
    assert(reloaded, "Expected an accessible draft");
    const libraries = await asMember.run((ctx) => readEvidenceLibraries(ctx));

    expect(saved.editVersion).toBe(1);
    expect(libraries).toEqual([]);
    expect(reloaded.draft.editVersion).toBe(1);
    expect(reloaded.library.name).toBe("Climate Evidence");
    expect(
      Object.fromEntries(
        reloaded.sections.map((section) => [
          section.sectionKey,
          section.payload,
        ]),
      ),
    ).toMatchObject(sections);
    await expect(
      asMember.query(api.evidenceLibraries.queries.getDraft, {
        libraryId: created.libraryId,
      }),
    ).resolves.toBeNull();
    await expect(
      asMember.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: toSectionRows(sections),
        expectedEditVersion: 1,
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      asAdmin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: toSectionRows(sections),
        expectedEditVersion: 0,
      }),
    ).rejects.toThrow(/CONFLICT.*Draft changed since it was loaded/);

    await expect(
      asAdmin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: toSectionRows({
          ...sections,
          localization: {
            locales: ["fr"],
            defaultLocale: "not-supported",
          },
        }),
        expectedEditVersion: 1,
      }),
    ).rejects.toThrow(/\/localization\/defaultLocale/);
    await expect(
      asAdmin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
        libraryId: created.libraryId,
        sections: toSectionRows({ ...sections, footer: { poweredBy: false } }),
        expectedEditVersion: 1,
      }),
    ).rejects.toThrow(/\/footer\/poweredBy/);
  });

  it("copies a draft into an immutable revision while later draft edits stay separate", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_revision",
        name: "Revision Team",
        slug: "revision-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        evidenceLibrariesEnabled: true,
      });
      await seedFeatureUser(ctx, "user_revision");
    await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_revision",
        clerkUserId: "user_revision",
        role: "org:admin",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await seedFeatureUser(ctx, "user_revision_member");
    await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_revision_member",
        clerkUserId: "user_revision_member",
        role: "org:member",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const admin = t.withIdentity({
      subject: "user_revision",
      o: { id: "org_revision", rol: "org:admin" },
    });
    const member = t.withIdentity({
      subject: "user_revision_member",
      o: { id: "org_revision", rol: "org:member" },
    });
    const created = await admin.run(async (ctx) =>
      createEvidenceLibrarySetup(ctx, { organizationId: (await admin.query(api.organizationFeatures.libraryOrganizations, {}))[0]!.id,
        name: "Revision Library",
        slug: "revision-library",
        publicAddress: "https://revision-library.example.org",
      }),
    );
    const published = configurationSections(
      "https://revision-library.example.org",
      "Published name",
    );
    const saved = await admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: created.libraryId,
        sections: toSectionRows(published),
        expectedEditVersion: 0,
      },
    );
    const finalized = await admin.mutation(
      api.evidenceLibraries.mutations.activateConfiguration,
      {
        libraryId: created.libraryId,
        expectedEditVersion: saved.editVersion,
      },
    );
    const libraryAfterFinalize = await admin.run((ctx) =>
      ctx.db.get(created.libraryId),
    );
    await admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
      libraryId: created.libraryId,
      sections: toSectionRows(
        configurationSections(
          "https://revision-library.example.org",
          "Unpublished edit",
        ),
      ),
      expectedEditVersion: finalized.editVersion,
    });
    await expect(
      member.run((ctx) =>
        readEvidenceLibraryRevision(ctx, {
          libraryId: created.libraryId,
          revisionId: finalized.revisionId,
        }),
      ),
    ).rejects.toThrow(/FORBIDDEN/);
    const revision = await admin.run((ctx) =>
      readEvidenceLibraryRevision(ctx, {
        libraryId: created.libraryId,
        revisionId: finalized.revisionId,
      }),
    );

    expect(finalized).toMatchObject({ revisionKey: "r2", revisionNumber: 2 });
    expect(libraryAfterFinalize).toMatchObject({
      latestRevisionId: finalized.revisionId,
      name: "Published name",
      state: "provisioning",
    });
    expect(libraryAfterFinalize).not.toHaveProperty("activeRevisionId");
    expect(revision.sections).toHaveLength(4);
    expect(
      revision.sections.find((section) => section.sectionKey === "identity"),
    ).toMatchObject({
      payload: published.identity,
    });
    expect(revision.revision).not.toHaveProperty("updatedAt");
  });
});
