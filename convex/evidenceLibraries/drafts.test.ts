/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import {
  createEvidenceLibrary,
  finalizeEvidenceLibraryDraft,
  saveEvidenceLibraryDraftSection,
} from "./mutations";
import {
  readEvidenceLibraries,
  readEvidenceLibraryDraft,
  readEvidenceLibraryRevision,
} from "./queries";

describe("Evidence Library draft storage", () => {
  it("stores one provenance-locked draft with section rows", async () => {
    const t = convexTest(schema);
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
      await ctx.db.insert("evidenceLibraryConfigSections", {
        kind: "draft",
        libraryId,
        draftId,
        sectionKey: "identity",
        payload: { name: "Climate Evidence" },
        payloadByteLength: 27,
        contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
        updatedByClerkUserId: "user_123",
        updatedAt: 3,
      });
      return await ctx.db
        .query("evidenceLibraryConfigDrafts")
        .withIndex("by_libraryId", (query) =>
          query.eq("libraryId", libraryId),
        )
        .unique();
    });

    expect(stored).toMatchObject({
      editVersion: 0,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    });
  });

  it("creates, saves, reloads, and rejects a stale draft edit", async () => {
    const t = convexTest(schema);
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
      createEvidenceLibrary(ctx, {
        name: "Climate Evidence",
        slug: "climate-evidence",
      }),
    );
    const saved = await asAdmin.run((ctx) =>
      saveEvidenceLibraryDraftSection(ctx, {
        libraryId: created.libraryId,
        sectionKey: "identity",
        payload: { name: "Climate Evidence" },
        expectedEditVersion: 0,
      }),
    );
    const reloaded = await asMember.run((ctx) =>
      readEvidenceLibraryDraft(ctx, { libraryId: created.libraryId }),
    );
    const libraries = await asMember.run((ctx) => readEvidenceLibraries(ctx));

    expect(saved.editVersion).toBe(1);
    expect(libraries).toEqual([
      expect.objectContaining({ _id: created.libraryId, slug: "climate-evidence" }),
    ]);
    expect(reloaded).toMatchObject({
      draft: { editVersion: 1 },
      library: { name: "Climate Evidence" },
      sections: [
        { sectionKey: "identity", payload: { name: "Climate Evidence" } },
      ],
    });
    await expect(
      asAdmin.run((ctx) =>
        saveEvidenceLibraryDraftSection(ctx, {
          libraryId: created.libraryId,
          sectionKey: "identity",
          payload: { name: "Stale overwrite" },
          expectedEditVersion: 0,
        }),
      ),
    ).rejects.toThrow(/CONFLICT.*Draft changed since it was loaded/);
  });

  it("copies a draft into an immutable revision while later draft edits stay separate", async () => {
    const t = convexTest(schema);
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
    });
    const admin = t.withIdentity({
      subject: "user_revision",
      o: { id: "org_revision", rol: "org:admin" },
    });
    const created = await admin.run((ctx) =>
      createEvidenceLibrary(ctx, { name: "Revision Library", slug: "revision-library" }),
    );
    await admin.run((ctx) =>
      saveEvidenceLibraryDraftSection(ctx, {
        libraryId: created.libraryId,
        sectionKey: "identity",
        payload: { name: "Published name" },
        expectedEditVersion: 0,
      }),
    );
    const finalized = await admin.run((ctx) =>
      finalizeEvidenceLibraryDraft(ctx, {
        libraryId: created.libraryId,
        expectedEditVersion: 1,
      }),
    );
    const libraryAfterFinalize = await admin.run((ctx) =>
      ctx.db.get(created.libraryId),
    );
    await admin.run((ctx) =>
      saveEvidenceLibraryDraftSection(ctx, {
        libraryId: created.libraryId,
        sectionKey: "identity",
        payload: { name: "Unpublished edit" },
        expectedEditVersion: 2,
      }),
    );
    const revision = await admin.run((ctx) =>
      readEvidenceLibraryRevision(ctx, {
        libraryId: created.libraryId,
        revisionId: finalized.revisionId,
      }),
    );

    expect(finalized).toMatchObject({ revisionKey: "r1", revisionNumber: 1 });
    expect(libraryAfterFinalize).toMatchObject({ state: "provisioning" });
    expect(libraryAfterFinalize).not.toHaveProperty("activeRevisionId");
    expect(revision.sections).toEqual([
      expect.objectContaining({
        sectionKey: "identity",
        payload: { name: "Published name" },
      }),
    ]);
    expect(revision.revision).not.toHaveProperty("updatedAt");
  });
});
