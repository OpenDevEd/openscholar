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

const modules = import.meta.glob("/convex/**/*.ts");

function configurationSections(baseUrl: string, name: string) {
  return {
    identity: {
      baseUrl,
      name,
      shortName: name,
      assets: {
        logoDark: "https://assets.example.org/library-logo.svg",
        favicon: "https://assets.example.org/library-favicon.ico",
      },
    },
    theme: { colors: { accent: "#005A9C", tertiary: "#F2A900" } },
    localization: { locales: ["en-GB", "fr"], defaultLocale: "en-GB" },
  };
}

describe("Evidence Library draft storage", () => {
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
      });
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
    const created = await admin.run((ctx) =>
      createEvidenceLibrarySetup(ctx, {
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
      admin.mutation(
        api.evidenceLibraries.mutations.saveEssentialConfiguration,
        {
          libraryId: created.libraryId,
          sections: {
            ...validSections,
            identity: {
              ...validSections.identity,
              assets: { ...validSections.identity.assets, logoDark: "" },
            },
          },
          expectedEditVersion: 0,
        },
      ),
    ).rejects.toThrow(/VALIDATION_ERROR/);
    await expect(
      admin.mutation(
        api.evidenceLibraries.mutations.saveEssentialConfiguration,
        {
          libraryId: created.libraryId,
          sections: {
            ...validSections,
            identity: {
              ...validSections.identity,
              baseUrl: "https://changed-address.example.org",
            },
          },
          expectedEditVersion: 0,
        },
      ),
    ).rejects.toThrow(/VALIDATION_ERROR/);

    const stored = await admin.run((ctx) =>
      readEvidenceLibraryDraft(ctx, { libraryId: created.libraryId }),
    );
    expect(stored.draft.editVersion).toBe(0);
    expect(stored.sections).toEqual([
      expect.objectContaining({
        sectionKey: "identity",
        payload: {
          baseUrl: "https://identity-library.example.org",
          name: "Identity Library",
          shortName: "Identity Library",
        },
      }),
    ]);
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
      });
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

    const created = await asAdmin.run((ctx) =>
      createEvidenceLibrarySetup(ctx, {
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
      api.evidenceLibraries.mutations.saveEssentialConfiguration,
      {
        libraryId: created.libraryId,
        sections,
        expectedEditVersion: 0,
      },
    );
    const reloaded = await asAdmin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId: created.libraryId },
    );
    const libraries = await asMember.run((ctx) => readEvidenceLibraries(ctx));

    expect(saved.editVersion).toBe(1);
    expect(libraries).toEqual([
      expect.objectContaining({
        _id: created.libraryId,
        slug: "climate-evidence",
      }),
    ]);
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
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      asMember.mutation(
        api.evidenceLibraries.mutations.saveEssentialConfiguration,
        {
          libraryId: created.libraryId,
          sections,
          expectedEditVersion: 1,
        },
      ),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      asAdmin.mutation(
        api.evidenceLibraries.mutations.saveEssentialConfiguration,
        {
          libraryId: created.libraryId,
          sections,
          expectedEditVersion: 0,
        },
      ),
    ).rejects.toThrow(/CONFLICT.*Draft changed since it was loaded/);

    await expect(
      asAdmin.mutation(
        api.evidenceLibraries.mutations.saveEssentialConfiguration,
        {
          libraryId: created.libraryId,
          sections: {
            ...sections,
            localization: {
              locales: ["fr"],
              defaultLocale: "not-supported",
            },
          },
          expectedEditVersion: 1,
        },
      ),
    ).rejects.toThrow(/\/localization\/defaultLocale/);
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
      });
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
    const created = await admin.run((ctx) =>
      createEvidenceLibrarySetup(ctx, {
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
      api.evidenceLibraries.mutations.saveEssentialConfiguration,
      {
        libraryId: created.libraryId,
        sections: published,
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
    await admin.mutation(
      api.evidenceLibraries.mutations.saveEssentialConfiguration,
      {
        libraryId: created.libraryId,
        sections: configurationSections(
          "https://revision-library.example.org",
          "Unpublished edit",
        ),
        expectedEditVersion: finalized.editVersion,
      },
    );
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
    expect(revision.sections).toHaveLength(3);
    expect(
      revision.sections.find((section) => section.sectionKey === "identity"),
    ).toMatchObject({
      payload: published.identity,
    });
    expect(revision.revision).not.toHaveProperty("updatedAt");
  });
});
