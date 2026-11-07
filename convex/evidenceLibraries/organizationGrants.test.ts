// Sharing a community with an organization (#1091): its owner shares it with an organization they're an admin
// of, or invites another's admin by email, who accepts it for an organization of theirs; every member of it then
// has the role, until they leave the organization or the grant goes.
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { readLibraryRole } from "./access";

type Fixture = Awaited<ReturnType<typeof createReadySetupFixture>>;

/** Another organization, Partners, with an admin and a member, each with an account; `ownerAdmins` makes the community's owner an admin of it too. */
async function partners(fixture: Fixture, { ownerAdmins = false } = {}) {
  return await fixture.t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_partners", name: "Partners", slug: "partners", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    const users: Record<string, Id<"users">> = {};
    const people: [string, "org:admin" | "org:member"][] = [["user_partner_admin", "org:admin"], ["user_partner_member", "org:member"], ...(ownerAdmins ? [[fixture.clerkUserId, "org:admin"] as [string, "org:admin"]] : [])];
    for (const [clerkUserId, role] of people) {
      users[clerkUserId] = (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique())?._id
        ?? (await ctx.db.insert("users", { clerkId: clerkUserId, email: `${clerkUserId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 }));
      await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}_partners`, clerkUserId, role, state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    }
    return { organizationId, users };
  });
}

const roleOf = (fixture: Fixture, clerkUserId: string) =>
  fixture.t.run(async (ctx) => readLibraryRole(ctx, (await ctx.db.get("evidenceLibraries", fixture.created.libraryId))!, clerkUserId));

describe("sharing a community with an organization", () => {
  it("gives every member of an organization its owner shares it with the role, until they leave or the grant goes", async () => {
    const fixture = await createReadySetupFixture("org_grant");
    const { organizationId } = await partners(fixture, { ownerAdmins: true });
    const libraryId = fixture.created.libraryId;

    expect((await fixture.admin.query(api.evidenceLibraries.organizationGrants.grantable, { libraryId })).page.map((row) => row.name)).toEqual(["Partners"]);
    await fixture.admin.mutation(api.evidenceLibraries.organizationGrants.grant, { libraryId, organizationId, role: "creator" });
    expect([await roleOf(fixture, "user_partner_admin"), await roleOf(fixture, "user_partner_member")]).toEqual(["creator", "creator"]);
    // Its team shows the organization as itself, and its count of people takes in its members.
    expect((await fixture.admin.query(api.evidenceLibraries.queries.listTeam, { libraryId })).organizations).toMatchObject([{ organizationId, name: "Partners", role: "creator" }]);
    await fixture.t.mutation(internal.evidenceLibraries.directory.recountPeople, { libraryId });
    expect((await fixture.t.run((ctx) => ctx.db.get("evidenceLibraries", libraryId)))?.people).toBe(3);
    // The member sees it among what's shared with them.
    const member = fixture.t.withIdentity({ subject: "user_partner_member" });
    const shared = await member.query(api.evidenceLibraries.queries.listLibraries, { from: "shared", paginationOpts: { cursor: null, numItems: 10 } });
    expect(shared.page.map((row) => [row.name, row.role])).toEqual([["Climate Evidence", "creator"]]);

    await fixture.admin.mutation(api.evidenceLibraries.organizationGrants.changeRole, { libraryId, organizationId, role: "editor" });
    expect(await roleOf(fixture, "user_partner_member")).toBe("editor");
    // Leaving the organization takes the role with it.
    await fixture.t.run(async (ctx) => {
      const membership = (await ctx.db.query("organizationMemberships").withIndex("by_clerkMembershipId", (q) => q.eq("clerkMembershipId", "orgmem_user_partner_member_partners")).unique())!;
      await ctx.db.patch("organizationMemberships", membership._id, { state: "revoked" });
    });
    expect(await roleOf(fixture, "user_partner_member")).toBeNull();
    await fixture.admin.mutation(api.evidenceLibraries.organizationGrants.remove, { libraryId, organizationId });
    expect(await roleOf(fixture, "user_partner_admin")).toBeNull();
  });

  it("lets only an organization's admin share it with that organization", async () => {
    const fixture = await createReadySetupFixture("org_grant_refused");
    const { organizationId } = await partners(fixture);
    await expect(fixture.admin.mutation(api.evidenceLibraries.organizationGrants.grant, { libraryId: fixture.created.libraryId, organizationId, role: "editor" })).rejects.toThrow(/admins/);
    // Its own organization owns it already.
    await expect(fixture.admin.mutation(api.evidenceLibraries.organizationGrants.grant, { libraryId: fixture.created.libraryId, organizationId: fixture.organizationId, role: "editor" })).rejects.toThrow(/owns this community/);
  });

  it("invites another organization's admin by email, who accepts it for the organization they pick", async () => {
    const fixture = await createReadySetupFixture("org_invite");
    const { organizationId, users } = await partners(fixture);
    const libraryId = fixture.created.libraryId;
    const owner = (await fixture.t.run((ctx) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", fixture.clerkUserId)).unique()))!._id;
    const email = "user_partner_admin@example.org";
    const invitationId = await fixture.t.mutation(internal.evidenceLibraries.invitations.prepare, { libraryId, email, role: "editor", toOrganization: true, actingAs: owner });
    expect((await fixture.admin.query(api.evidenceLibraries.queries.listTeam, { libraryId })).invitations).toMatchObject([{ email, toOrganization: true }]);
    const answer = (as: Id<"users">, extra: { organizationId?: Id<"organizations"> }) =>
      fixture.t.mutation(internal.evidenceLibraries.invitations.respondVerified, { invitationId, emails: [email], accept: true, actingAs: as, ...extra });

    // It's accepted for an organization, which they must be an admin of.
    await expect(answer(users.user_partner_admin, {})).rejects.toThrow(/Choose which/);
    await expect(answer(users.user_partner_admin, { organizationId: fixture.organizationId })).rejects.toThrow(/admins/);
    await answer(users.user_partner_admin, { organizationId });
    expect(await roleOf(fixture, "user_partner_member")).toBe("editor");
    expect((await fixture.t.run((ctx) => ctx.db.get("itemInvitations", invitationId)))?.state).toBe("accepted");

    // Its owner lowers the organization's role; an invitation accepted after that doesn't raise it again.
    await fixture.admin.mutation(api.evidenceLibraries.organizationGrants.changeRole, { libraryId, organizationId, role: "creator" });
    const again = await fixture.t.mutation(internal.evidenceLibraries.invitations.prepare, { libraryId, email, role: "editor", toOrganization: true, actingAs: owner });
    await fixture.t.mutation(internal.evidenceLibraries.invitations.respondVerified, { invitationId: again, emails: [email], accept: true, actingAs: users.user_partner_admin, organizationId });
    expect(await roleOf(fixture, "user_partner_member")).toBe("creator");
  });
});
