// Organizations in OpenScholar (#651): made, joined, run and left through Clerk.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { fakeAutumnFetch } from "../billing/billing.test-support";

/** Clerk's Backend API for organizations, as far as these actions use it, kept in memory. */
function fakeClerk() {
  // Clerk's times are milliseconds, as its webhooks' are.
  let clock = Date.now();
  let ids = 0;
  const organizations = new Map<string, Record<string, unknown>>();
  const memberships = new Map<string, Record<string, unknown>>();
  const invitations = new Map<string, Record<string, unknown>>();
  const membership = (orgId: string, userId: string, role: string) => {
    const row = { id: `orgmem_${++ids}`, role, created_at: ++clock, updated_at: clock, public_user_data: { user_id: userId }, organization: organizations.get(orgId) };
    memberships.set(`${orgId}/${userId}`, row);
    return row;
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? "GET";
    let match: RegExpMatchArray | null;
    if (path === "/instance") return json({ id: "ins_test" });
    if (path === "/organizations" && method === "POST") {
      const id = `org_${++ids}`;
      organizations.set(id, { id, name: body.name, slug: `${body.name.toLowerCase()}-${ids}`, created_at: ++clock, updated_at: clock, public_metadata: {} });
      membership(id, body.created_by, "org:admin");
      return json(organizations.get(id));
    }
    if ((match = path.match(/^\/organizations\/([^/]+)$/))) {
      const organization = organizations.get(match[1]);
      if (!organization) return json({ errors: [{ code: "resource_not_found" }] }, 404);
      if (method === "PATCH") Object.assign(organization, { ...body, updated_at: ++clock });
      if (method === "DELETE") {
        organizations.delete(match[1]);
        return json({ id: match[1], object: "organization", deleted: true });
      }
      return json(organization);
    }
    if ((match = path.match(/^\/organizations\/([^/]+)\/memberships$/))) {
      const userId = url.searchParams.get("user_id");
      return json({ data: [...memberships.entries()].filter(([key]) => key === `${match![1]}/${userId}`).map(([, row]) => row) });
    }
    if ((match = path.match(/^\/organizations\/([^/]+)\/memberships\/([^/]+)$/))) {
      const key = `${match[1]}/${match[2]}`;
      const row = memberships.get(key);
      if (!row) return json({ errors: [{ code: "resource_not_found" }] }, 404);
      if (method === "PATCH") Object.assign(row, { role: body.role, updated_at: ++clock });
      if (method === "DELETE") memberships.delete(key);
      return json(row);
    }
    if ((match = path.match(/^\/organizations\/([^/]+)\/invitations\/bulk$/))) {
      if ([...memberships.keys()].filter((key) => key.startsWith(`${match![1]}/`)).length + body.length > 5) return json({ errors: [{ code: "organization_membership_quota_exceeded" }] }, 403);
      return json(
        body.map((one: { email_address: string; role: string; public_metadata: unknown }) => {
          const row = { id: `orginv_${++ids}`, organization_id: match![1], email_address: one.email_address, role: one.role, status: "pending", public_metadata: one.public_metadata, created_at: ++clock, updated_at: clock };
          invitations.set(row.id, row);
          return row;
        }),
      );
    }
    if ((match = path.match(/^\/organizations\/([^/]+)\/invitations\/([^/]+)\/revoke$/))) {
      const row = invitations.get(match[2])!;
      Object.assign(row, { status: "revoked", updated_at: ++clock });
      return json(row);
    }
    throw new Error(`Clerk has no ${method} ${path} here`);
  });
  /** Someone accepts an invitation in Clerk's own client; Clerk's webhooks tell OpenScholar. */
  const accept = (invitationId: string, userId: string) => {
    const invitation = invitations.get(invitationId)!;
    Object.assign(invitation, { status: "accepted", updated_at: ++clock });
    return { invitation, membership: membership(String(invitation.organization_id), userId, String(invitation.role)) };
  };
  return { fetch, accept };
}

let clerk: ReturnType<typeof fakeClerk>;
beforeEach(() => {
  clerk = fakeClerk();
  // Each organization gets its Autumn customer as it's made.
  vi.stubGlobal("fetch", fakeAutumnFetch(clerk.fetch as typeof fetch));
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dev.openscholar.ai");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function people() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const add = (clerkId: string, firstName: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, firstName, state: "active", createdAt: 1, updatedAt: 1 });
    return { alice: await add("alice", "Alice"), bob: await add("bob", "Bob") };
  });
  const [alice, bob] = ["alice", "bob"].map((subject) => t.withIdentity({ subject }));
  /** A Clerk webhook, as Svix delivers it. */
  const webhook = (eventType: string, data: unknown, eventId: string) =>
    t.mutation(eventType.startsWith("organizationInvitation.") ? internal.webhooks.projections.applyOrganizationInvitationEvent : internal.webhooks.projections.applyOrganizationMembershipEvent, {
      eventId, eventType, instanceId: "ins_test", occurredAt: (data as { updated_at: number }).updated_at, payloadSha256: eventId,
      ...(eventType.startsWith("organizationInvitation.") ? { invitation: invitationSnapshot(data) } : { action: "upsert", membership: membershipSnapshot(data) }),
    } as never);
  return { t, ...ids, aliceAs: alice, bobAs: bob, webhook };
}

const invitationSnapshot = (row: any) => ({ clerkInvitationId: row.id, clerkOrganizationId: row.organization_id, email: row.email_address, role: row.role, state: row.status, ...(row.public_metadata?.inviterClerkUserId ? { inviterClerkUserId: row.public_metadata.inviterClerkUserId } : {}), clerkCreatedAt: row.created_at, clerkUpdatedAt: row.updated_at });
const membershipSnapshot = (row: any) => ({
  clerkMembershipId: row.id, clerkUserId: row.public_user_data.user_id, role: row.role, state: "active", clerkCreatedAt: row.created_at, clerkUpdatedAt: row.updated_at,
  organization: { clerkOrganizationId: row.organization.id, name: row.organization.name, slug: row.organization.slug, evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, devEnabled: false, clerkCreatedAt: row.organization.created_at, clerkUpdatedAt: row.organization.updated_at },
});
const page = { paginationOpts: { cursor: null, numItems: 20 } };

describe("an organization", () => {
  it("is made with its maker as its admin, invites people who join through Clerk, and keeps one admin", async () => {
    const { t, bob, aliceAs, bobAs, webhook } = await people();
    // Made at once: no waiting for Clerk's webhook before switching to it.
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    expect(lab.slug).toMatch(/^lab-/);
    expect((await aliceAs.query(api.organizations.queries.workspaces, page)).page.map(({ kind, name, role, members }) => ({ kind, name, role, members }))).toEqual([
      { kind: "personal", name: "Alice", role: "admin", members: undefined },
      { kind: "organization", name: "Lab", role: "admin", members: 1 },
    ]);
    const inLab = { workspaceId: lab.workspaceId };

    // Alice invites Bob; he sees it, with who sent it, and Clerk's link brings him to the join page.
    expect(await aliceAs.action(api.organizations.manage.invite, { ...inLab, emails: ["Bob@Example.org", "carol@example.org"], role: "member" })).toEqual({ invited: 2 });
    expect(clerk.fetch.mock.calls.some(([, init]) => String(init?.body).includes("https://dev.openscholar.ai/join/lab-"))).toBe(true);
    const [invited] = (await bobAs.query(api.organizations.queries.myInvitations, page)).page;
    expect(invited).toMatchObject({ organization: { name: "Lab" }, role: "member", invitedBy: { name: "Alice" } });
    // Only an organization's admins invite, and a member can't answer another's invitation.
    await expect(aliceAs.action(api.organizations.manage.invite, { emails: ["dan@example.org"], role: "member" })).rejects.toThrow(/own workspace/);
    await expect(aliceAs.action(api.organizations.manage.declineInvitation, { invitationId: invited.invitationId })).rejects.toThrow(/no longer open/);

    // He accepts in Clerk's client; Clerk's webhooks make him a member.
    const accepted = clerk.accept(invited.clerkInvitationId, "bob");
    await webhook("organizationInvitation.accepted", accepted.invitation, "msg_1");
    await webhook("organizationMembership.created", accepted.membership, "msg_2");
    expect((await bobAs.query(api.organizations.queries.myInvitations, page)).page).toEqual([]);
    expect((await aliceAs.query(api.organizations.queries.members, { ...inLab, ...page })).page.map(({ name, role, you }) => [name, role, you])).toEqual([["Alice", "admin", true], ["Bob", "member", false]]);
    // Alice takes back Carol's invitation.
    const [carol] = (await aliceAs.query(api.organizations.queries.invitations, { ...inLab, ...page })).page;
    await aliceAs.action(api.organizations.manage.revokeInvitation, { ...inLab, invitationId: carol.invitationId });
    expect((await aliceAs.query(api.organizations.queries.invitations, { ...inLab, ...page })).page).toEqual([]);

    // A member changes no one's role. The only admin can't leave, or stop being one, until someone else is an admin.
    await expect(bobAs.action(api.organizations.manage.setRole, { ...inLab, userId: bob, role: "admin" })).rejects.toThrow(/Only an admin/);
    const alice = (await aliceAs.query(api.organizations.queries.members, { ...inLab, ...page })).page.find((member) => member.you)!.userId;
    await expect(aliceAs.action(api.organizations.manage.leave, inLab)).rejects.toThrow(/only admin/);
    await expect(aliceAs.action(api.organizations.manage.setRole, { ...inLab, userId: alice, role: "member" })).rejects.toThrow(/only admin/);
    const { undo } = await aliceAs.action(api.organizations.manage.setRole, { ...inLab, userId: bob, role: "admin" });
    expect(undo).toEqual({ path: "organizations/manage:setRole", args: { userId: bob, role: "member" } });
    await aliceAs.action(api.organizations.manage.leave, inLab);
    expect((await aliceAs.query(api.organizations.queries.workspaces, page)).page.map(({ name }) => name)).toEqual(["Alice"]);
    // What she left is no longer hers to act in.
    await expect(aliceAs.query(api.organizations.queries.members, { ...inLab, ...page })).rejects.toThrow(/not found/);

    // Bob renames it, with an undo, and can't delete it while it has an Evidence Library.
    expect((await bobAs.action(api.organizations.manage.rename, { ...inLab, name: "Learning Lab" })).undo).toEqual({ path: "organizations/manage:rename", args: { name: "Lab" } });
    const libraryId = await t.run((ctx) => ctx.db.insert("evidenceLibraries", { workspaceId: lab.workspaceId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "bob", updatedByClerkUserId: "bob", createdAt: 1, updatedAt: 1 }));
    await expect(bobAs.action(api.organizations.manage.deleteOrganization, inLab)).rejects.toThrow(/Evidence Library, Library/);
    await t.run((ctx) => ctx.db.delete("evidenceLibraries", libraryId));
    await bobAs.action(api.organizations.manage.deleteOrganization, inLab);
    expect((await bobAs.query(api.organizations.queries.workspaces, page)).page.map(({ name }) => name)).toEqual(["Bob"]);
  });

  it("says when its plan has room for no more members", async () => {
    const { aliceAs } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const emails = Array.from({ length: 5 }, (_, i) => `person${i}@example.org`);
    await expect(aliceAs.action(api.organizations.manage.invite, { workspaceId: lab.workspaceId, emails, role: "member" })).rejects.toThrow(/as many members as its plan allows/);
  });

  it("lets someone decline an invitation sent to them", async () => {
    const { aliceAs, bobAs } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    await aliceAs.action(api.organizations.manage.invite, { workspaceId: lab.workspaceId, emails: ["bob@example.org"], role: "admin" });
    const [invited] = (await bobAs.query(api.organizations.queries.myInvitations, page)).page;
    expect(invited.role).toBe("admin");
    await bobAs.action(api.organizations.manage.declineInvitation, { invitationId: invited.invitationId as Id<"organizationInvitations"> });
    expect((await bobAs.query(api.organizations.queries.myInvitations, page)).page).toEqual([]);
  });
});
