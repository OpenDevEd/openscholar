import { seedFeatureUser } from "../organizationFeatures.test-support";
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { applyUserDeleteProjection } from "../users/internal";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

describe("listTeam", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists inherited owners and keeps unassigned organization members outside the library", async () => {
    const fixture = await createActivatedSetupFixture("team");
    const libraryId = fixture.created.libraryId;
    await fixture.t.run(async (ctx) => {
      const organizationId = (await ctx.db.get("evidenceLibraries", libraryId))!.organizationId;
      const stamp = { clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 };
      await ctx.db.patch("users", await seedFeatureUser(ctx, "user_team"), {
        clerkId: "user_team",
        email: "ada@example.org",
        firstName: "Ada",
        lastName: "Lovelace",
        avatarUrl: "https://images.example.org/ada.png",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "user_editor",
        email: "grace@example.org",
        firstName: "Grace",
        avatarUrl: "https://images.example.org/grace.png",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_editor",
        clerkUserId: "user_editor",
        role: "org:member",
        state: "active",
        ...stamp,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_gone",
        clerkUserId: "user_gone",
        role: "org:member",
        state: "revoked",
        ...stamp,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_new",
        clerkUserId: "user_new",
        role: "org:member",
        state: "active",
        ...stamp,
      });
    });

    await expect(
      fixture.admin.query(api.evidenceLibraries.queries.listTeam, { libraryId }),
    ).resolves.toEqual({
      organizationName: "Team team",
      invitations: [],
      owners: [{ clerkUserId: "user_team", name: "Ada Lovelace", email: "ada@example.org", imageUrl: "https://images.example.org/ada.png" }],
      editors: [],
      creators: [],
      availablePeople: [
        { clerkUserId: "user_new", name: "", email: "" },
        { clerkUserId: "user_editor", name: "Grace", email: "grace@example.org", imageUrl: "https://images.example.org/grace.png" },
      ],
    });

    // The published home page names everyone with a role, and nobody else.
    // An email is private: a member with an email but no name is left off, never shown by their address.
    await fixture.t.run(async ctx => {
      await ctx.db.insert("users", {libraryItemCount: 0,  clerkId: "user_unnamed", email: "private@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("evidenceLibraryMembers", { libraryId, clerkUserId: "user_unnamed", role: "editor", grantedBy: "owner", grantedAt: 1 });
    });
    await fixture.admin.mutation(api.evidenceLibraries.team.addOrganizationMember, { libraryId, clerkUserId: "user_new", role: "creator" });
    await fixture.admin.mutation(api.evidenceLibraries.team.addOrganizationMember, { libraryId, clerkUserId: "user_editor", role: "editor" });
    const team = await fixture.t.query(internal.evidenceLibraries.queries.readLibraryTeamForAssembly, { libraryId });
    expect(team).toHaveLength(2);
    expect(team).toEqual(expect.arrayContaining([
      { id: "user_team", name: "Ada Lovelace", photo: "https://images.example.org/ada.png" },
      { id: "user_editor", name: "Grace", photo: "https://images.example.org/grace.png" },
    ]));
  });

  it("grants and revokes a library role without relying on an active organization", async () => {
    const fixture = await createActivatedSetupFixture("team_grants");
    const libraryId = fixture.created.libraryId;
    await fixture.t.run(async ctx => {
      const library = (await ctx.db.get("evidenceLibraries", libraryId))!;
      await ctx.db.insert("organizationMemberships", {
        organizationId: library.organizationId, clerkMembershipId: "orgmem_creator",
        clerkUserId: "user_creator", role: "org:member", state: "active",
        clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1,
      });
    });
    const creator = fixture.t.withIdentity({ subject: "user_creator" });
    expect(await creator.query(api.evidenceLibraries.queries.listLibraryOverviews, {})).toEqual([]);
    await fixture.admin.mutation(api.evidenceLibraries.team.addOrganizationMember, { libraryId, clerkUserId: "user_creator", role: "creator" });
    expect(await creator.query(api.evidenceLibraries.queries.listLibraryOverviews, {})).toEqual([
      expect.objectContaining({ _id: libraryId, role: "creator" }),
    ]);
    await expect(creator.query(api.evidenceLibraries.queries.listTeam, { libraryId })).rejects.toThrow();
    await expect(creator.mutation(api.evidenceLibraries.team.changeRole, { libraryId, clerkUserId: "user_creator", role: "editor" })).rejects.toThrow();
    await fixture.admin.mutation(api.evidenceLibraries.team.changeRole, { libraryId, clerkUserId: "user_creator", role: "editor" });
    expect(await creator.query(api.evidenceLibraries.queries.listLibraryOverviews, {})).toEqual([
      expect.objectContaining({ _id: libraryId, role: "editor" }),
    ]);
    await fixture.admin.mutation(api.evidenceLibraries.team.removeMember, { libraryId, clerkUserId: "user_creator" });
    expect(await creator.query(api.evidenceLibraries.queries.listLibraryOverviews, {})).toEqual([]);
  });

  it("removes deleted users' grants and never offers them as organization candidates", async () => {
    const fixture = await createActivatedSetupFixture("deleted_team_user");
    const libraryId = fixture.created.libraryId;
    await fixture.t.run(async ctx => {
      const library = (await ctx.db.get("evidenceLibraries", libraryId))!;
      await ctx.db.insert("users", {libraryItemCount: 0, clerkId: "deleted_user", email: "deleted@example.org", state: "active", createdAt: 1, updatedAt: 1});
      await ctx.db.insert("organizationMemberships", {organizationId: library.organizationId, clerkMembershipId: "deleted_membership", clerkUserId: "deleted_user", role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1});
      await ctx.db.insert("evidenceLibraryMembers", {libraryId, clerkUserId: "deleted_user", role: "creator", grantedBy: "owner", grantedAt: 1});
      await applyUserDeleteProjection(ctx, {entityId: "deleted_user", entityType: "user", clerkId: "deleted_user", eventId: "delete-user", eventType: "user.deleted", instanceId: "instance", occurredAt: 2, processedAt: 2, payloadSha256: "a".repeat(64)});
    });
    const team = await fixture.admin.query(api.evidenceLibraries.queries.listTeam, {libraryId});
    expect([...team.creators, ...team.availablePeople].map(person => person.clerkUserId)).not.toContain("deleted_user");
    expect(await fixture.t.run(ctx => ctx.db.query("evidenceLibraryMembers").withIndex("by_clerkUserId", q => q.eq("clerkUserId", "deleted_user")).collect())).toEqual([]);
  });

  it("refuses a library from another organisation", async () => {
    const fixture = await createActivatedSetupFixture("team_other");
    const stranger = fixture.t.withIdentity({
      subject: "user_stranger",
      o: { id: "org_elsewhere", rol: "org:admin" },
    });
    await expect(
      stranger.query(api.evidenceLibraries.queries.listTeam, {
        libraryId: fixture.created.libraryId,
      }),
    ).rejects.toThrow();
  });
});
