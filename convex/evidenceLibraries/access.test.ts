/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";

import {
  canPerformOrganizationAction,
  parseOrganizationClaims,
  requireEvidenceLibraryAccess,
  requireOrganizationAccess,
} from "./access";

describe("parseOrganizationClaims", () => {
  test("accepts the verified active-organization admin claim", () => {
    expect(
      parseOrganizationClaims({
        subject: "user_admin",
        o: {
          id: "org_evidence_library",
          rol: "org:admin",
        },
      }),
    ).toEqual({
      organizationId: "org_evidence_library",
      role: "org:admin",
      canManage: true,
    });
  });

  test("rejects missing, unprefixed, and Clerk v1 organization claims", () => {
    expect(parseOrganizationClaims({ subject: "user_missing" })).toBeNull();
    expect(
      parseOrganizationClaims({
        subject: "user_default_token",
        o: { id: "org_evidence_library", rol: "admin" },
      }),
    ).toBeNull();
    expect(
      parseOrganizationClaims({
        subject: "user_legacy",
        org_id: "org_evidence_library",
        org_role: "org:admin",
      }),
    ).toBeNull();
  });
});

describe("canPerformOrganizationAction", () => {
  test("allows admins to manage while members remain read-only", () => {
    expect(canPerformOrganizationAction("org:admin", "read")).toBe(true);
    expect(canPerformOrganizationAction("org:admin", "manage")).toBe(true);
    expect(canPerformOrganizationAction("org:member", "read")).toBe(true);
    expect(canPerformOrganizationAction("org:member", "manage")).toBe(false);
  });
});

describe("requireOrganizationAccess", () => {
  async function seedMembership(
    role: "org:admin" | "org:member",
    state: "active" | "revoked" = "active",
    // "never-set" stands for a row written before the switch existed.
    evidenceLibrariesEnabled: boolean | "never-set" = true,
  ) {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_evidence_library",
        name: "Evidence Team",
        slug: "evidence-team",
        state: "active",
        ...(evidenceLibrariesEnabled === "never-set"
          ? {}
          : { evidenceLibrariesEnabled }),
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

  test("allows a matching active admin to manage", async () => {
    const t = await seedMembership("org:admin");
    const access = await t
      .withIdentity({
        subject: "user_123",
        o: { id: "org_evidence_library", rol: "org:admin" },
      })
      .run((ctx) => requireOrganizationAccess(ctx, "manage"));

    expect(access).toMatchObject({
      clerkUserId: "user_123",
      organization: { clerkOrganizationId: "org_evidence_library" },
      role: "org:admin",
    });
  });

  test("allows a matching active member to read but not manage", async () => {
    const t = await seedMembership("org:member");
    const asMember = t.withIdentity({
      subject: "user_123",
      o: { id: "org_evidence_library", rol: "org:member" },
    });

    await expect(asMember.run((ctx) => requireOrganizationAccess(ctx, "read"))).resolves
      .toMatchObject({ role: "org:member" });
    await expect(
      asMember.run((ctx) => requireOrganizationAccess(ctx, "manage")),
    ).rejects.toThrow(/FORBIDDEN.*Evidence Library access denied/);
  });

  test.each([
    ["anonymous", null],
    [
      "wrong active organization",
      { subject: "user_123", o: { id: "org_other", rol: "org:admin" } },
    ],
    [
      "role mismatch",
      {
        subject: "user_123",
        o: { id: "org_evidence_library", rol: "org:member" },
      },
    ],
  ])("uses the same denial contract for %s", async (_label, identity) => {
    const t = await seedMembership("org:admin");
    const attempt = identity
      ? t.withIdentity(identity).run((ctx) => requireOrganizationAccess(ctx, "read"))
      : t.run((ctx) => requireOrganizationAccess(ctx, "read"));

    await expect(attempt).rejects.toThrow(/FORBIDDEN.*Evidence Library access denied/);
  });

  test("denies a revoked projection", async () => {
    const t = await seedMembership("org:admin", "revoked");
    await expect(
      t
        .withIdentity({
          subject: "user_123",
          o: { id: "org_evidence_library", rol: "org:admin" },
        })
        .run((ctx) => requireOrganizationAccess(ctx, "read")),
    ).rejects.toThrow(/FORBIDDEN.*Evidence Library access denied/);
  });

  describe("the Evidence Libraries switch", () => {
    const admin = {
      subject: "user_123",
      o: { id: "org_evidence_library", rol: "org:admin" },
    };

    test.each([
      ["switched off", false],
      ["never switched on", "never-set"],
    ] as const)("refuses to manage when the organisation is %s", async (_label, flag) => {
      const t = await seedMembership("org:admin", "active", flag);

      await expect(
        t.withIdentity(admin).run((ctx) => requireOrganizationAccess(ctx, "manage")),
      ).rejects.toThrow(
        /FORBIDDEN.*Evidence Libraries are not switched on for this organisation\./,
      );
    });

    test("still allows reading, so an active library keeps its admin launch", async () => {
      const t = await seedMembership("org:admin", "active", false);

      await expect(
        t.withIdentity(admin).run((ctx) => requireOrganizationAccess(ctx, "read")),
      ).resolves.toMatchObject({ role: "org:admin" });
    });

    test("allows managing when the organisation is switched on", async () => {
      const t = await seedMembership("org:admin", "active", true);

      await expect(
        t.withIdentity(admin).run((ctx) => requireOrganizationAccess(ctx, "manage")),
      ).resolves.toMatchObject({
        organization: { evidenceLibrariesEnabled: true },
      });
    });

    test("refuses to manage a library in a switched-off organisation", async () => {
      const t = await seedMembership("org:admin", "active", false);
      const libraryId = await t.run(async (ctx) => {
        const organization = await ctx.db
          .query("organizations")
          .withIndex("by_clerkOrganizationId", (query) =>
            query.eq("clerkOrganizationId", "org_evidence_library"),
          )
          .unique();
        return await ctx.db.insert("evidenceLibraries", {
          organizationId: organization!._id,
          name: "Existing Library",
          slug: "existing-library",
          state: "active",
          createdByClerkUserId: "user_123",
          updatedByClerkUserId: "user_123",
          createdAt: 1,
          updatedAt: 1,
        });
      });

      await expect(
        t
          .withIdentity(admin)
          .run((ctx) => requireEvidenceLibraryAccess(ctx, libraryId, "manage")),
      ).rejects.toThrow(
        /FORBIDDEN.*Evidence Libraries are not switched on for this organisation\./,
      );
      await expect(
        t
          .withIdentity(admin)
          .run((ctx) => requireEvidenceLibraryAccess(ctx, libraryId, "read")),
      ).resolves.toMatchObject({ library: { name: "Existing Library" } });
    });
  });

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
