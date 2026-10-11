import { seedFeatureUser } from "../organizationFeatures.test-support";
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { applyUserDeleteProjection } from "../users/internal";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { organizationOfLibrary } from "../../tests/helpers/evidence-library-setup-fixture";
import { grantLibraryRole } from "./team.test-support";

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
      const organizationId = await organizationOfLibrary(ctx, libraryId);
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
      await ctx.db.insert("users", {
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
      await ctx.db.insert("users", { clerkId: "user_new", email: "new@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_new",
        clerkUserId: "user_new",
        role: "org:member",
        state: "active",
        ...stamp,
      });
      // A member whose account hasn't reached us yet: a role is given to an account, so the picker waits for theirs.
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_unseen",
        clerkUserId: "user_unseen",
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
    });
    // The organization's other active members are offered by the picker, a page at a time; the owner and the revoked member aren't.
    const candidates = await fixture.admin.query(api.evidenceLibraries.queries.listOrganizationPeople, { libraryId, paginationOpts: { cursor: null, numItems: 20 } });
    expect(candidates.page).toEqual(expect.arrayContaining([
      { clerkUserId: "user_new", name: "", email: "new@example.org" },
      { clerkUserId: "user_editor", name: "Grace", email: "grace@example.org", imageUrl: "https://images.example.org/grace.png" },
    ]));
    expect(candidates.page).toHaveLength(2);
    // The invite form finds a member by an email Clerk keeps in capitals, whatever its case.
    await fixture.t.run(async (ctx) => { const user = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "user_editor")).unique())!; await ctx.db.patch("users", user._id, { email: "Grace@Example.org" }); });
    expect(await fixture.admin.query(api.evidenceLibraries.queries.isOrganizationPerson, { libraryId, email: "grace@example.org" })).toBe(true);
    expect(await fixture.admin.query(api.evidenceLibraries.queries.isOrganizationPerson, { libraryId, email: "nobody@example.org" })).toBe(false);
    // Found by a word of their name.
    expect((await fixture.admin.query(api.evidenceLibraries.queries.listOrganizationPeople, { libraryId, search: "grace", paginationOpts: { cursor: null, numItems: 20 } })).page.map((person) => person.clerkUserId)).toEqual(["user_editor"]);

    // The published home page names everyone with a role, and nobody else.
    // An email is private: a member with an email but no name is left off, never shown by their address.
    await fixture.t.run(async ctx => {
      await ctx.db.insert("users", {clerkId: "user_unnamed", email: "private@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      await grantLibraryRole(ctx, libraryId, "user_unnamed", "editor");
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
      await ctx.db.insert("users", { clerkId: "user_creator", email: "creator@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("organizationMemberships", {
        organizationId: await organizationOfLibrary(ctx, libraryId), clerkMembershipId: "orgmem_creator",
        clerkUserId: "user_creator", role: "org:member", state: "active",
        clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1,
      });
    });
    const creator = fixture.t.withIdentity({ subject: "user_creator" });
    const organization = await fixture.t.run(ctx => organizationOfLibrary(ctx, libraryId));
    const inOrganization = async () => (await creator.query(api.evidenceLibraries.queries.listLibraries, { organization, paginationOpts: { cursor: null, numItems: 50 } })).page.map(({ _id, role }) => ({ _id, role }));
    expect((await creator.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([]);
    // With no role in it, a member of its organization views it there, and has nothing to do with its admin.
    expect(await inOrganization()).toEqual([{ _id: libraryId, role: "viewer" }]);
    // Their account suspended, the membership that outlives it views nothing.
    const account = (state: "active" | "suspended") => fixture.t.run(async ctx => ctx.db.patch("users", (await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", "user_creator")).unique())!._id, { state }));
    await account("suspended");
    expect(await inOrganization()).toEqual([]);
    await account("active");
    // Invited by email before they were picked from the organization: the role they're given answers the invitation, and holds its place.
    await fixture.admin.mutation(internal.evidenceLibraries.invitations.prepare, { libraryId, email: "creator@example.org", role: "editor" });
    await fixture.admin.mutation(api.evidenceLibraries.team.addOrganizationMember, { libraryId, clerkUserId: "user_creator", role: "creator" });
    expect(await fixture.t.run(async ctx => (await ctx.db.query("itemInvitations").collect()).map(({ email, state }) => ({ email, state })))).toEqual([{ email: "creator@example.org", state: "accepted" }]);
    expect(await inOrganization()).toEqual([{ _id: libraryId, role: "creator" }]);
    expect((await creator.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([
      expect.objectContaining({ _id: libraryId, role: "creator" }),
    ]);
    // A creator reads who has a role (#653), and changes no one's.
    expect((await creator.query(api.evidenceLibraries.queries.listTeam, { libraryId })).creators.map((person) => person.clerkUserId)).toEqual(["user_creator"]);
    await expect(creator.mutation(api.evidenceLibraries.team.changeRole, { libraryId, clerkUserId: "user_creator", role: "editor" })).rejects.toThrow();
    await fixture.admin.mutation(api.evidenceLibraries.team.changeRole, { libraryId, clerkUserId: "user_creator", role: "editor" });
    expect((await creator.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([
      expect.objectContaining({ _id: libraryId, role: "editor" }),
    ]);
    await fixture.admin.mutation(api.evidenceLibraries.team.removeMember, { libraryId, clerkUserId: "user_creator" });
    expect((await creator.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([]);
    expect(await inOrganization()).toEqual([{ _id: libraryId, role: "viewer" }]);
  });

  it("shows a library's settings to every member of its organization, read-only to all but its owners", async () => {
    const fixture = await createActivatedSetupFixture("team_view");
    const libraryId = fixture.created.libraryId;
    await fixture.t.run(async ctx => {
      await ctx.db.insert("users", { clerkId: "user_member", email: "member@example.org", firstName: "Mo", state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("organizationMemberships", {
        organizationId: await organizationOfLibrary(ctx, libraryId), clerkMembershipId: "orgmem_member",
        clerkUserId: "user_member", role: "org:member", state: "active",
        clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1,
      });
    });
    await fixture.admin.mutation(internal.evidenceLibraries.invitations.prepare, { libraryId, email: "guest@example.org", role: "editor" });
    const member = fixture.t.withIdentity({ subject: "user_member" });
    const owners = await fixture.admin.query(api.evidenceLibraries.queries.getDraft, { libraryId });
    expect(owners).toMatchObject({ role: "owner", editable: true });
    // A member with no role in it reads its settings (#653), and who has a role, but not who was invited.
    expect(await member.query(api.evidenceLibraries.queries.getDraft, { libraryId })).toMatchObject({ role: "viewer", editable: false, sections: owners!.sections });
    const read = await member.query(api.evidenceLibraries.queries.listTeam, { libraryId });
    expect(read.invitations).toEqual([]);
    expect(read.owners.map((person) => person.email)).toEqual([""]);
    expect((await fixture.admin.query(api.evidenceLibraries.queries.listTeam, { libraryId })).invitations).toHaveLength(1);
    // Changing them is its owners'.
    await expect(member.mutation(api.evidenceLibraries.mutations.saveDraftSections, { libraryId, expectedEditVersion: owners!.draft.editVersion, sections: [] })).rejects.toThrow(/access denied/i);
    // Someone outside its organization reads nothing of it, nor does a suspended member.
    expect(await fixture.t.withIdentity({ subject: "user_stranger" }).query(api.evidenceLibraries.queries.getDraft, { libraryId })).toBeNull();
    await fixture.t.run(async ctx => ctx.db.patch("users", (await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", "user_member")).unique())!._id, { state: "suspended" }));
    expect(await member.query(api.evidenceLibraries.queries.getDraft, { libraryId })).toBeNull();
  });

  it("removes deleted users' grants and never offers them as organization candidates", async () => {
    const fixture = await createActivatedSetupFixture("deleted_team_user");
    const libraryId = fixture.created.libraryId;
    await fixture.t.run(async ctx => {
      await ctx.db.insert("users", {clerkId: "deleted_user", email: "deleted@example.org", state: "active", createdAt: 1, updatedAt: 1});
      await ctx.db.insert("organizationMemberships", {organizationId: await organizationOfLibrary(ctx, libraryId), clerkMembershipId: "deleted_membership", clerkUserId: "deleted_user", role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1});
      await grantLibraryRole(ctx, libraryId, "deleted_user", "creator");
      await applyUserDeleteProjection(ctx, {entityId: "deleted_user", entityType: "user", clerkId: "deleted_user", eventId: "delete-user", eventType: "user.deleted", instanceId: "instance", occurredAt: 2, processedAt: 2, payloadSha256: "a".repeat(64)});
    });
    const team = await fixture.admin.query(api.evidenceLibraries.queries.listTeam, {libraryId});
    const candidates = await fixture.admin.query(api.evidenceLibraries.queries.listOrganizationPeople, {libraryId, paginationOpts: {cursor: null, numItems: 50}});
    expect([...team.creators, ...candidates.page].map(person => person.clerkUserId)).not.toContain("deleted_user");
    expect(await fixture.t.run(ctx => ctx.db.query("itemAccess").collect())).toEqual([]);
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
