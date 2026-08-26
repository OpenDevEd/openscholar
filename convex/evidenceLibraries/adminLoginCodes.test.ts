/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  createDeployedSetupFixture,
  createReadySetupFixture,
  essentialSetupSections,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedMember(
  role: "org:admin" | "org:member",
  state: "active" | "revoked" = "active",
) {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_admin_login_code",
      name: "Admin Login Code Team",
      slug: "admin-login-code-team",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: "orgmem_admin_login_code",
      clerkUserId: "user_admin_login_code",
      role,
      state,
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const libraryId = await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: "Admin Login Code Library",
      slug: "admin-login-code-library",
      state: "active",
      createdByClerkUserId: "user_admin_login_code",
      updatedByClerkUserId: "user_admin_login_code",
      createdAt: 1,
      updatedAt: 1,
    });
    return { libraryId, organizationId };
  });
  const member = t.withIdentity({
    subject: "user_admin_login_code",
    o: { id: "org_admin_login_code", rol: role },
  });
  return { member, t, ...seeded };
}

async function seedReadyMember(role: "org:admin" | "org:member") {
  const fixture = await createReadySetupFixture("admin_login_code");
  if (role === "org:member") {
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.membershipId, { role });
    });
  }
  const member = fixture.t.withIdentity({
    subject: fixture.clerkUserId,
    o: { id: fixture.clerkOrganizationId, rol: role },
  });
  return { ...fixture, libraryId: fixture.created.libraryId, member };
}

describe("Evidence Library admin login codes", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("issues an opaque five-minute Owner code and stores only its digest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T14:00:00.000Z"));
    const { created, libraryId, member, organizationId, t } =
      await seedReadyMember("org:admin");

    const issued = await member.action(
      api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
      { libraryId },
    );

    expect(issued.code).toMatch(/^elc_[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toBe(Date.now() + 5 * 60 * 1000);
    const launchUrl = new URL(issued.launchUrl);
    expect(launchUrl.origin).toBe(new URL(created.publicAddress).origin);
    expect(launchUrl.pathname).toBe("/api/admin/session");
    expect(launchUrl.searchParams.get("code")).toBe(issued.code);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("evidenceLibraryAdminLoginCodes")
        .withIndex("by_libraryId_and_codeDigest", (query) =>
          query
            .eq("libraryId", libraryId)
            .eq(
              "codeDigest",
              createHash("sha256").update(issued.code).digest("hex"),
            ),
        )
        .take(2),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        libraryId,
        organizationId,
        clerkUserId: "user_admin_login_code",
        role: "owner",
        codeDigest: createHash("sha256").update(issued.code).digest("hex"),
        issuedAt: Date.now(),
        expiresAt: issued.expiresAt,
      }),
    ]);
    expect(rows[0]).not.toHaveProperty("code");
    expect(rows[0]).not.toHaveProperty("consumedAt");

    const auditRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_action", (query) =>
          query.eq("action", "evidence_library.admin_login_code.issued"),
        )
        .take(2),
    );
    expect(auditRows).toEqual([
      expect.objectContaining({
        userId: "user_admin_login_code",
        metadata: {
          codeId: rows[0]._id,
          libraryId,
          organizationId,
          role: "owner",
        },
      }),
    ]);
  });

  it("binds an active Editor code to the mapped Editor role", async () => {
    const { libraryId, member, t } = await seedReadyMember("org:member");

    const issued = await member.action(
      api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
      { libraryId },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("evidenceLibraryAdminLoginCodes")
        .withIndex("by_libraryId_and_codeDigest", (query) =>
          query
            .eq("libraryId", libraryId)
            .eq(
              "codeDigest",
              createHash("sha256").update(issued.code).digest("hex"),
            ),
        )
        .take(2),
    );
    expect(rows).toEqual([expect.objectContaining({ role: "editor" })]);
  });

  it("shows launch readiness to the owning organization without exposing another organization's library", async () => {
    const { libraryId, member, t } = await seedReadyMember("org:member");

    await expect(
      member.query(api.evidenceLibraries.queries.getAdminLaunchState, {
        libraryId,
      }),
    ).resolves.toEqual({
      libraryId,
      libraryName: "Climate Evidence",
      status: "ready",
    });

    const otherLibraryId = await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_hidden",
        name: "Hidden Team",
        slug: "hidden-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("evidenceLibraries", {
        organizationId: otherOrganizationId,
        name: "Hidden Library",
        slug: "hidden-library",
        state: "active",
        createdByClerkUserId: "user_hidden",
        updatedByClerkUserId: "user_hidden",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      member.query(api.evidenceLibraries.queries.getAdminLaunchState, {
        libraryId: otherLibraryId,
      }),
    ).resolves.toBeNull();
  });

  it("does not issue or advertise a code before the library runtime is ready", async () => {
    const fixture = await createDeployedSetupFixture(
      "admin_login_code_not_ready",
    );
    const libraryId = fixture.created.libraryId;

    await expect(
      fixture.admin.query(api.evidenceLibraries.queries.getAdminLaunchState, {
        libraryId,
      }),
    ).resolves.toEqual({
      libraryId,
      libraryName: "Climate Evidence",
      status: "not_ready",
    });
    await expect(
      fixture.admin.action(
        api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
        { libraryId },
      ),
    ).rejects.toThrow(/Evidence Library is not ready/);

    const rows = await fixture.t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryAdminLoginCodes").take(1),
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps the active runtime launchable while a newer revision waits for deployment", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
    const fixture = await createReadySetupFixture(
      "admin_login_code_pending_revision",
    );
    const activeRevisionId = fixture.activated.revisionId;
    const saved = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: fixture.created.libraryId,
        sections: toSectionRows({
          ...essentialSetupSections,
          identity: {
            ...essentialSetupSections.identity,
            shortName: "Updated Climate",
          },
        }),
        expectedEditVersion: fixture.activated.editVersion,
      },
    );
    const pending = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.activateConfiguration,
      {
        libraryId: fixture.created.libraryId,
        expectedEditVersion: saved.editVersion,
      },
    );

    expect(pending).toMatchObject({ kind: "publish", status: "running" });
    const library = await fixture.t.run((ctx) =>
      ctx.db.get("evidenceLibraries", fixture.created.libraryId),
    );
    expect(library).toMatchObject({
      activeRevisionId,
      latestRevisionId: pending.revisionId,
    });
    await expect(
      fixture.admin.query(api.evidenceLibraries.queries.getAdminLaunchState, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      fixture.admin.action(
        api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
        { libraryId: fixture.created.libraryId },
      ),
    ).resolves.toMatchObject({
      launchUrl: expect.stringContaining("/api/admin/session?code="),
    });
  });

  it.each([
    {
      label: "anonymous caller",
      membershipRole: "org:admin" as const,
      membershipState: "active" as const,
      identity: null,
    },
    {
      label: "revoked member",
      membershipRole: "org:admin" as const,
      membershipState: "revoked" as const,
      identity: {
        subject: "user_admin_login_code",
        o: { id: "org_admin_login_code", rol: "org:admin" },
      },
    },
    {
      label: "wrong active organization",
      membershipRole: "org:admin" as const,
      membershipState: "active" as const,
      identity: {
        subject: "user_admin_login_code",
        o: { id: "org_other", rol: "org:admin" },
      },
    },
    {
      label: "stale role claim",
      membershipRole: "org:admin" as const,
      membershipState: "active" as const,
      identity: {
        subject: "user_admin_login_code",
        o: { id: "org_admin_login_code", rol: "org:member" },
      },
    },
  ])("rejects a $label without storing a code", async (scenario) => {
    const { libraryId, t } = await seedMember(
      scenario.membershipRole,
      scenario.membershipState,
    );
    const caller = scenario.identity ? t.withIdentity(scenario.identity) : t;

    await expect(
      caller.action(
        api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
        { libraryId },
      ),
    ).rejects.toThrow(/Evidence Library access denied/);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryAdminLoginCodes").take(1),
    );
    expect(rows).toHaveLength(0);
  });

  it("rejects a library owned by another organization without storing a code", async () => {
    const { member, t } = await seedMember("org:admin");
    const otherLibraryId = await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_other",
        name: "Other Team",
        slug: "other-team",
        state: "active",
        clerkCreatedAt: 1,
        clerkUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("evidenceLibraries", {
        organizationId: otherOrganizationId,
        name: "Other Library",
        slug: "other-library",
        state: "active",
        createdByClerkUserId: "user_other",
        updatedByClerkUserId: "user_other",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      member.action(
        api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
        { libraryId: otherLibraryId },
      ),
    ).rejects.toThrow(/Evidence Library access denied/);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryAdminLoginCodes").take(1),
    );
    expect(rows).toHaveLength(0);
  });
});
