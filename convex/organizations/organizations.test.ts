// Organizations in OpenScholar (#651): made, joined, run and left through Clerk.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { fakeAutumn, fakeAutumnFetch } from "../billing/billing.test-support";
import { ORGANIZATION_PLAN, TEAM_PLAN } from "../../lib/billing/plans";
import { paperOf } from "../lib/paperRef.test-support";

/** Clerk's Backend API for organizations, as far as these actions use it, kept in memory. */
function fakeClerk() {
  // Clerk's times are real milliseconds, as its webhooks' are.
  let clock = Date.now();
  const now = () => (clock = Math.max(clock + 1, Date.now()));
  let ids = 0;
  const organizations = new Map<string, Record<string, unknown>>();
  const memberships = new Map<string, Record<string, unknown>>();
  const invitations = new Map<string, Record<string, unknown>>();
  const membership = (orgId: string, userId: string, role: string) => {
    const row = { id: `orgmem_${++ids}`, role, created_at: now(), updated_at: clock, public_user_data: { user_id: userId }, organization: organizations.get(orgId) };
    memberships.set(`${orgId}/${userId}`, row);
    return row;
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  let failDeletion = false;
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? "GET";
    let match: RegExpMatchArray | null;
    if (path === "/instance") return json({ id: "ins_test" });
    if (path === "/organizations" && method === "POST") {
      if ([...organizations.values()].some((one) => one.slug === body.slug)) return json({ errors: [{ code: "form_identifier_exists", meta: { param_name: "slug" } }] }, 422);
      const id = `org_${++ids}`;
      organizations.set(id, { id, name: body.name, slug: body.slug, created_at: now(), updated_at: clock, public_metadata: {} });
      membership(id, body.created_by, "org:admin");
      return json(organizations.get(id));
    }
    if ((match = path.match(/^\/organizations\/([^/]+)$/))) {
      const organization = organizations.get(match[1]);
      if (!organization) return json({ errors: [{ code: "resource_not_found" }] }, 404);
      if (method === "PATCH") Object.assign(organization, { ...body, updated_at: now() });
      if (method === "DELETE") {
        if (failDeletion) return json({ errors: [{ code: "internal" }] }, 500);
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
      if (method === "PATCH") Object.assign(row, { role: body.role, updated_at: now() });
      if (method === "DELETE") memberships.delete(key);
      return json(row);
    }
    if ((match = path.match(/^\/organizations\/([^/]+)\/invitations\/bulk$/))) {
      if ([...memberships.keys()].filter((key) => key.startsWith(`${match![1]}/`)).length + body.length > 5) return json({ errors: [{ code: "organization_membership_quota_exceeded" }] }, 403);
      return json(
        body.map((one: { email_address: string; role: string; public_metadata: unknown }) => {
          // Expires in a week: a Node timer past about 24.8 days fires at once, as a far later expiry would here.
          const row = { id: `orginv_${++ids}`, organization_id: match![1], email_address: one.email_address, role: one.role, status: "pending", public_metadata: one.public_metadata, created_at: now(), updated_at: clock, expires_at: clock + 7 * 86_400_000 };
          invitations.set(row.id, row);
          return row;
        }),
      );
    }
    if ((match = path.match(/^\/organizations\/([^/]+)\/invitations\/([^/]+)\/revoke$/))) {
      const row = invitations.get(match[2])!;
      Object.assign(row, { status: "revoked", updated_at: now() });
      return json(row);
    }
    throw new Error(`Clerk has no ${method} ${path} here`);
  });
  /** Someone accepts an invitation in Clerk's own client; Clerk's webhooks tell OpenScholar. */
  const accept = (invitationId: string, userId: string) => {
    const invitation = invitations.get(invitationId)!;
    Object.assign(invitation, { status: "accepted", updated_at: now() });
    return { invitation, membership: membership(String(invitation.organization_id), userId, String(invitation.role)) };
  };
  return { fetch, accept, failDeletions: (fail: boolean) => (failDeletion = fail), invitations };
}

let clerk: ReturnType<typeof fakeClerk>;
beforeEach(() => {
  clerk = fakeClerk();
  fakeAutumn.reset();
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
  organization: { clerkOrganizationId: row.organization.id, name: row.organization.name, slug: row.organization.slug, devEnabled: false, clerkCreatedAt: row.organization.created_at, clerkUpdatedAt: row.organization.updated_at },
});
const page = { paginationOpts: { cursor: null, numItems: 20 } };

describe("an organization", () => {
  it("invites someone at any address Clerk verified on their account, and lets them decline it", async () => {
    const { t, bob, aliceAs, bobAs } = await people();
    await t.run((ctx) => ctx.db.patch("users", bob, { verifiedEmails: ["bob@example.org", "bob@lab.example.org"] }));
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const field = await aliceAs.action(api.organizations.manage.create, { name: "Field" });
    await aliceAs.action(api.organizations.manage.invite, { workspaceId: lab.workspaceId, emails: ["bob@example.org"], role: "member" });
    await aliceAs.action(api.organizations.manage.invite, { workspaceId: field.workspaceId, emails: ["bob@lab.example.org"], role: "member" });
    // Both, newest first, one page at a time.
    const first = await bobAs.query(api.organizations.queries.myInvitations, { paginationOpts: { cursor: null, numItems: 1 } });
    const second = await bobAs.query(api.organizations.queries.myInvitations, { paginationOpts: { cursor: first.continueCursor, numItems: 1 } });
    expect([...first.page, ...second.page].map((invitation) => invitation.organization.name)).toEqual(["Field", "Lab"]);
    await bobAs.action(api.organizations.manage.declineInvitation, { invitationId: first.page[0].invitationId });
  });

  it("is made with its maker as its admin, invites people who join through Clerk, and keeps one admin", async () => {
    const { t, bob, aliceAs, bobAs, webhook } = await people();
    // Made at once: no waiting for Clerk's webhook before switching to it.
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    expect(lab.slug).toBe("lab");
    expect((await aliceAs.query(api.organizations.queries.workspaces, page)).page.map(({ kind, name, role, members }) => ({ kind, name, role, members }))).toEqual([
      { kind: "personal", name: "Alice", role: "admin", members: undefined },
      { kind: "organization", name: "Lab", role: "admin", members: 1 },
    ]);
    const inLab = { workspaceId: lab.workspaceId };

    // Alice invites Bob; he sees it, with who sent it, and Clerk's link brings him to the join page.
    expect(await aliceAs.action(api.organizations.manage.invite, { ...inLab, emails: ["Bob@Example.org", "carol@example.org"], role: "member" })).toEqual({ invited: 2 });
    expect(clerk.fetch.mock.calls.some(([, init]) => String(init?.body).includes("https://dev.openscholar.ai/join/lab\""))).toBe(true);
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
    // Making herself a member has no undo: she couldn't make anyone an admin after it.
    expect((await aliceAs.action(api.organizations.manage.setRole, { ...inLab, userId: alice, role: "member" })).undo).toBeUndefined();
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

  it("sends an invitation again as a new one, and takes the colour its admins pick, with an undo", async () => {
    const { aliceAs } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const inLab = { workspaceId: lab.workspaceId };
    await aliceAs.action(api.organizations.manage.invite, { ...inLab, emails: ["carol@example.org"], role: "admin" });
    const [first] = (await aliceAs.query(api.organizations.queries.invitations, { ...inLab, ...page })).page;
    await aliceAs.action(api.organizations.manage.resendInvitation, { ...inLab, invitationId: first.invitationId });
    const [again, ...more] = (await aliceAs.query(api.organizations.queries.invitations, { ...inLab, ...page })).page;
    expect(more).toEqual([]);
    expect(again).toMatchObject({ email: "carol@example.org", role: "admin" });
    expect(again.invitationId).not.toBe(first.invitationId);

    const colourOf = async () => (await aliceAs.query(api.organizations.queries.workspaces, page)).page.find((one) => one.kind === "organization")?.colour;
    const { undo } = await aliceAs.mutation(api.organizations.manage.setColour, { ...inLab, colour: "#0d9488" });
    expect(await colourOf()).toBe("#0d9488");
    await aliceAs.mutation(api.organizations.manage.setColour, { ...inLab, ...undo!.args });
    expect(await colourOf()).toBeUndefined();
  });

  it("closes someone's invitation once they're a member, before Clerk says they accepted it", async () => {
    const { aliceAs, bobAs, webhook } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const inLab = { workspaceId: lab.workspaceId };
    await aliceAs.action(api.organizations.manage.invite, { ...inLab, emails: ["bob@example.org"], role: "member" });
    const [invited] = (await bobAs.query(api.organizations.queries.myInvitations, page)).page;
    const sent = clerk.invitations.get(invited.clerkInvitationId)!;
    const before = { ...sent };
    const accepted = clerk.accept(invited.clerkInvitationId, "bob");
    await webhook("organizationMembership.created", accepted.membership, "msg_1");
    expect((await aliceAs.query(api.organizations.queries.invitations, { ...inLab, ...page })).page).toEqual([]);
    expect((await bobAs.query(api.organizations.queries.myInvitations, page)).page).toEqual([]);
    // Clerk's event from when it was sent, arriving late, doesn't open it again.
    await webhook("organizationInvitation.created", before, "msg_0");
    expect((await aliceAs.query(api.organizations.queries.invitations, { ...inLab, ...page })).page).toEqual([]);
  });

  it("takes the address its name gives, or that with a few letters after it when another has it", async () => {
    const { aliceAs } = await people();
    expect((await aliceAs.action(api.organizations.manage.create, { name: "Évidence Lab!" })).slug).toBe("evidence-lab");
    expect((await aliceAs.action(api.organizations.manage.create, { name: "Evidence lab" })).slug).toMatch(/^evidence-lab-[0-9a-f]{4}$/);
    expect((await aliceAs.action(api.organizations.manage.create, { name: "研究室" })).slug).toBe("organization");
  });

  it("takes credits bought in it from its admins, charged to it, and refuses its members", async () => {
    const { t, aliceAs, bobAs, webhook } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const inLab = { workspaceId: lab.workspaceId };
    await t.run((ctx) => ctx.db.insert("billingCatalog", { plans: [{ id: "top_up", name: "Credit top-up", addOn: true, autoEnable: false, credits: { included: 0, interval: "one_off", unitPrice: { amount: 1, billingUnits: 10_000 } }, features: [], popular: false }], features: [], syncedAt: Date.now() }));
    await aliceAs.action(api.organizations.manage.invite, { ...inLab, emails: ["bob@example.org"], role: "member" });
    const [invited] = (await bobAs.query(api.organizations.queries.myInvitations, page)).page;
    await webhook("organizationMembership.created", clerk.accept(invited.clerkInvitationId, "bob").membership, "msg_1");
    const attached: Array<Record<string, unknown>> = [];
    const through = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith("/v1/billing.attach")) attached.push(JSON.parse(String(init?.body)));
      return through(input, init);
    });
    await expect(bobAs.action(api.billing.actions.buyCredits, { ...inLab, credits: 10_000 })).rejects.toThrow(/Only an admin/);
    await aliceAs.action(api.billing.actions.buyCredits, { ...inLab, credits: 10_000 });
    expect(attached).toEqual([expect.objectContaining({ customer_id: lab.workspaceId, plan_id: "top_up" })]);
  });

  it("gives a deleted organization's address to the next one that takes it", async () => {
    const { aliceAs } = await people();
    const first = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    await aliceAs.action(api.organizations.manage.deleteOrganization, { workspaceId: first.workspaceId });
    const second = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    expect(second.slug).toBe("lab");
    expect(await aliceAs.query(api.workspaces.queries.bySlug, { slug: "lab" })).toBe(second.workspaceId);
  });

  it("tells the assistant what refuses deleting it before the person is asked", async () => {
    const { t, alice, bob, aliceAs, bobAs, webhook } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    await aliceAs.action(api.organizations.manage.invite, { workspaceId: lab.workspaceId, emails: ["bob@example.org"], role: "member" });
    const [invited] = (await bobAs.query(api.organizations.queries.myInvitations, page)).page;
    await webhook("organizationMembership.created", clerk.accept(invited.clerkInvitationId, "bob").membership, "msg_1");
    const refusal = (userId: Id<"users">) => t.query(internal.assistant.asking.check, { userId, workspaceId: lab.workspaceId, path: "organizations/manage:deleteOrganization", input: "{}" });
    expect(await refusal(bob)).toMatch(/Only an admin/);
    expect(await refusal(alice)).toBeNull();
    await t.run((ctx) => ctx.db.insert("evidenceLibraries", { workspaceId: lab.workspaceId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "alice", updatedByClerkUserId: "alice", createdAt: 1, updatedAt: 1 }));
    expect(await refusal(alice)).toMatch(/Evidence Library, Library/);
  });

  it("takes its workspace and what's in it with it when it's deleted", async () => {
    const { t, aliceAs, alice } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const inLab = { workspaceId: lab.workspaceId };
    await aliceAs.mutation(api.library.collections.createCollection, { ...inLab, name: "Trials" });
    // Papers near a document's 1 MiB: a step reading too many of them at once would pass Convex's 16 MiB a transaction, and never finish.
    const abstract = "x".repeat(900 * 1024);
    for (let i = 0; i < 20; i++) {
      await t.run((ctx) => ctx.db.insert("libraryItems", { workspaceId: lab.workspaceId, createdBy: alice, ...paperOf(`https://openalex.org/W${i}`), title: `Paper ${i}`, authors: [], abstract, journal: "", citedByCount: 0, publicationYear: 2020, searchableText: "", savedAt: i, updatedAt: i }));
    }
    await aliceAs.action(api.organizations.manage.deleteOrganization, inLab);
    const organizationId = await t.run(async (ctx) => (await ctx.db.get("workspaces", lab.workspaceId))!.kind === "organization" ? ((await ctx.db.get("workspaces", lab.workspaceId)) as { organizationId: Id<"organizations"> }).organizationId : null);
    // Keeping Clerk's deletion schedules the purge.
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((call) => call.name.includes("purgeOrganization"))).toBe(true);
    for (let step = 0; step < 10 && (await t.run((ctx) => ctx.db.get("workspaces", lab.workspaceId))); step++) await t.mutation(internal.workspaces.purge.purgeOrganization, { organizationId: organizationId! });
    expect(await t.run((ctx) => ctx.db.get("workspaces", lab.workspaceId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("collections").withIndex("by_workspace_sortName", (q) => q.eq("workspaceId", lab.workspaceId)).collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("libraryItems").withIndex("by_workspace", (q) => q.eq("workspaceId", lab.workspaceId)).collect())).toEqual([]);
  });

  it("says when its plan has room for no more members", async () => {
    const { aliceAs } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const emails = Array.from({ length: 5 }, (_, i) => `person${i}@example.org`);
    await expect(aliceAs.action(api.organizations.manage.invite, { workspaceId: lab.workspaceId, emails, role: "member" })).rejects.toThrow(/as many members as its plan allows/);
  });

  it("keeps an admin when its two admins each make the other a member at the same moment", async () => {
    const { bob, aliceAs, bobAs, webhook } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const inLab = { workspaceId: lab.workspaceId };
    await aliceAs.action(api.organizations.manage.invite, { ...inLab, emails: ["bob@example.org"], role: "admin" });
    const [invited] = (await bobAs.query(api.organizations.queries.myInvitations, page)).page;
    const accepted = clerk.accept(invited.clerkInvitationId, "bob");
    await webhook("organizationInvitation.accepted", accepted.invitation, "msg_1");
    await webhook("organizationMembership.created", accepted.membership, "msg_2");
    const members = () => aliceAs.query(api.organizations.queries.members, { ...inLab, ...page });
    const alice = (await members()).page.find((member) => member.you)!.userId;

    const changes = await Promise.allSettled([
      aliceAs.action(api.organizations.manage.setRole, { ...inLab, userId: bob, role: "member" }),
      bobAs.action(api.organizations.manage.setRole, { ...inLab, userId: alice, role: "member" }),
    ]);
    expect(changes.map((change) => change.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await members()).page.filter((member) => member.role === "admin")).toHaveLength(1);
    // The hold is gone with the change: the admin left makes the other one again.
    const admin = changes[0].status === "fulfilled" ? aliceAs : bobAs;
    await admin.action(api.organizations.manage.setRole, { ...inLab, userId: changes[0].status === "fulfilled" ? bob : alice, role: "admin" });
    expect((await members()).page.filter((member) => member.role === "admin")).toHaveLength(2);
  });

  it("invites the new addresses of a list that also names a member or someone already invited", async () => {
    const { aliceAs } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const invite = (...emails: string[]) => aliceAs.action(api.organizations.manage.invite, { workspaceId: lab.workspaceId, emails, role: "member" });
    const open = () => [...clerk.invitations.values()].filter((row) => row.status === "pending").map((row) => row.email_address);
    await invite("carol@example.org");
    // Alice is a member, with her address in another case, and Carol is invited: Dan alone is new.
    expect(await invite("Alice@Example.org", "carol@example.org", "dan@example.org")).toEqual({ invited: 1 });
    expect(open()).toEqual(["carol@example.org", "dan@example.org"]);
    // A list with nobody new is refused, as one address is.
    await expect(invite("alice@example.org", "dan@example.org")).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  });

  it("takes back the invitations Clerk let past its room, as it lets requests made at the same moment", async () => {
    const { aliceAs } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const invite = (...emails: string[]) => aliceAs.action(api.organizations.manage.invite, { workspaceId: lab.workspaceId, emails, role: "member" });
    const open = () => [...clerk.invitations.values()].filter((row) => row.status === "pending").map((row) => row.email_address);
    await invite("a@example.org", "b@example.org", "c@example.org");
    // This Clerk counts members alone, so it lets every request here through.
    expect(await invite("d@example.org", "e@example.org")).toEqual({ invited: 1 });
    await expect(invite("f@example.org")).rejects.toThrow();
    expect(open()).toEqual(["a@example.org", "b@example.org", "c@example.org", "d@example.org"]);
    expect((await aliceAs.query(api.billing.seats.counts, { workspaceId: lab.workspaceId }))?.invitations).toBe(4);
  });

  it("on Team, fills the seats bought with members and invitations, and buys the ones missing when asked, sending nothing on a declined card", async () => {
    const { aliceAs } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const inLab = { workspaceId: lab.workspaceId };
    await aliceAs.action(api.billing.actions.moveToTeam, { ...inLab, seats: 2 });
    const invite = (emails: string[], addSeat?: true) => aliceAs.action(api.organizations.manage.invite, { ...inLab, emails, role: "member", ...(addSeat ? { addSeat } : {}) });
    const open = () => [...clerk.invitations.values()].filter((row) => row.status === "pending").map((row) => row.email_address);
    // Alice and Bob's invitation fill both seats.
    expect(await invite(["bob@example.org"])).toEqual({ invited: 1 });
    await expect(invite(["carol@example.org"])).rejects.toThrow(/as many members as its plan allows/);
    fakeAutumn.declineCard = true;
    await expect(invite(["carol@example.org"], true)).rejects.toThrow(/declined/);
    fakeAutumn.declineCard = false;
    // A bank that asks to confirm the charge gets its page; nothing is sent meanwhile.
    fakeAutumn.confirmPayments = true;
    await expect(invite(["carol@example.org"], true)).rejects.toMatchObject({ data: { code: "BILLING_PAYMENT_ACTION_REQUIRED", url: "https://checkout.test" } });
    fakeAutumn.confirmPayments = false;
    expect(open()).toEqual(["bob@example.org"]);
    expect(await invite(["carol@example.org", "dan@example.org"], true)).toEqual({ invited: 2 });
    expect(await aliceAs.query(api.billing.seats.counts, inLab)).toEqual({ members: 1, invitations: 3, seats: 4, held: 0 });
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

  it("takes no new work while it's being deleted, and is worked in again if the deletion fails", async () => {
    const { t, aliceAs } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const inLab = { workspaceId: lab.workspaceId };
    fakeAutumn.customer(lab.workspaceId).planId = TEAM_PLAN;
    // While a deletion runs, nobody acts in it: no Evidence Library can be made to strand.
    const deletingAt = await t.mutation(internal.organizations.read.beginDeletion, inLab);
    await expect(aliceAs.mutation(api.library.collections.createCollection, { ...inLab, name: "Late" })).rejects.toThrow(/Workspace not found/);
    // Its pages stop reading it at once, as its address no longer names a workspace, instead of every read failing.
    expect(await aliceAs.query(api.workspaces.queries.bySlug, { slug: "lab" })).toBeNull();
    const organizationId = await t.run(async (ctx) => (await ctx.db.query("organizations").first())!._id);
    await t.mutation(internal.organizations.read.endDeletion, { organizationId, deletingAt });
    expect(await aliceAs.query(api.workspaces.queries.bySlug, { slug: "lab" })).toBe(lab.workspaceId);
    clerk.failDeletions(true);
    await expect(aliceAs.action(api.organizations.manage.deleteOrganization, inLab)).rejects.toThrow();
    // Its Team plan ended first, so nothing of it would be billed once it's gone (#652). Clerk didn't delete it, so it's hers to work in again, on Free.
    expect(fakeAutumn.customer(lab.workspaceId).planId).toBe(ORGANIZATION_PLAN);
    expect((await aliceAs.query(api.organizations.queries.members, { ...inLab, ...page })).page).toHaveLength(1);
  });

  it("keeps someone who is invited back at once after being removed", async () => {
    const { bob, aliceAs, bobAs, webhook } = await people();
    const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
    const inLab = { workspaceId: lab.workspaceId };
    await aliceAs.action(api.organizations.manage.invite, { ...inLab, emails: ["bob@example.org"], role: "member" });
    const join = async (eventId: string) => {
      const [invited] = (await bobAs.query(api.organizations.queries.myInvitations, page)).page;
      const accepted = clerk.accept(invited.clerkInvitationId, "bob");
      await webhook("organizationInvitation.accepted", accepted.invitation, `${eventId}_invitation`);
      await webhook("organizationMembership.created", accepted.membership, eventId);
    };
    await join("msg_first");
    // Some time passes before she removes him, as it does.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await aliceAs.action(api.organizations.manage.removeMember, { ...inLab, userId: bob });
    expect((await bobAs.query(api.organizations.queries.workspaces, page)).page.map(({ name }) => name)).toEqual(["Bob"]);
    // Invited back and joined again: the earlier removal is older than the new membership.
    await aliceAs.action(api.organizations.manage.invite, { ...inLab, emails: ["bob@example.org"], role: "member" });
    await join("msg_second");
    expect((await bobAs.query(api.organizations.queries.workspaces, page)).page.map(({ name }) => name)).toEqual(["Bob", "Lab"]);
  });

  it("drops an invitation from the lists once its link expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { t, aliceAs, bobAs } = await people();
      const lab = await aliceAs.action(api.organizations.manage.create, { name: "Lab" });
      await aliceAs.action(api.organizations.manage.invite, { workspaceId: lab.workspaceId, emails: ["bob@example.org"], role: "member" });
      expect((await bobAs.query(api.organizations.queries.myInvitations, page)).page).toHaveLength(1);
      vi.advanceTimersByTime(8 * 86_400_000);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await bobAs.query(api.organizations.queries.myInvitations, page)).page).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
