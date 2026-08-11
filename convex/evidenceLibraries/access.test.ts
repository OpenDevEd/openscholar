/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";

import {
  canPerformOrganizationAction,
  parseOrganizationClaims,
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
  ) {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_evidence_library",
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
});
