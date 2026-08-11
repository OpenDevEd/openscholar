/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import {
  createEvidenceLibrary,
  saveEvidenceLibraryDraftSection,
} from "./mutations";
import { readEvidenceLibraryDraft } from "./queries";

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

    expect(saved.editVersion).toBe(1);
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
});
