/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";

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
});
