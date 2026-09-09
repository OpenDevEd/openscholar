/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";

import { requireEvidenceLibraryAccess } from "./access";

describe("library access", () => {
  async function seedMembership(
    role: "org:admin" | "org:member",
    state: "active" | "revoked" = "active",
    evidenceLibrariesEnabled = true,
  ) {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_evidence_library",
        name: "Evidence Team",
        slug: "evidence-team",
        state: "active",
        evidenceLibrariesEnabled,
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_123",
        clerkUserId: "user_123",
        role,
        state,
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    return t;
  }

  test("makes missing and cross-tenant library denials indistinguishable", async () => {
    const t = await seedMembership("org:admin");
    const { crossTenantLibraryId, missingLibraryId } = await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_other",
        name: "Other Team",
        slug: "other-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        evidenceLibrariesEnabled: true,
      });
      const crossTenantLibraryId = await ctx.db.insert("evidenceLibraries", {
        organizationId: otherOrganizationId,
        name: "Other Library",
        slug: "other-library",
        state: "active",
        createdByClerkUserId: "user_other",
        updatedByClerkUserId: "user_other",
        createdAt: 1,
        updatedAt: 1,
      });
      const missingLibraryId = await ctx.db.insert("evidenceLibraries", {
        organizationId: otherOrganizationId,
        name: "Deleted Library",
        slug: "deleted-library",
        state: "active",
        createdByClerkUserId: "user_other",
        updatedByClerkUserId: "user_other",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete("evidenceLibraries", missingLibraryId);
      return { crossTenantLibraryId, missingLibraryId };
    });
    const admin = t.withIdentity({
      subject: "user_123",
      o: { id: "org_evidence_library", rol: "org:admin" },
    });
    async function rejectionMessage(promise: Promise<unknown>) {
      try {
        await promise;
        return "resolved";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }

    const crossTenant = await rejectionMessage(
      admin.run((ctx) =>
        requireEvidenceLibraryAccess(ctx, crossTenantLibraryId, "read"),
      ),
    );
    const missing = await rejectionMessage(
      admin.run((ctx) =>
        requireEvidenceLibraryAccess(ctx, missingLibraryId, "read"),
      ),
    );

    expect(crossTenant).toMatch(/FORBIDDEN.*Evidence Library access denied/);
    expect(missing).toBe(crossTenant);
  });
});
