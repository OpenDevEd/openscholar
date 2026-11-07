/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { organizationOfLibrary } from "../../tests/helpers/evidence-library-setup-fixture";

const mail = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => mail } }));

async function setup(extraSections: Record<string, unknown> = {}) {
  const fixture = await createActivatedSetupFixture("invitations", extraSections);
  const libraryId = fixture.created.libraryId;
  await fixture.t.run(ctx => ctx.db.insert("users", {clerkId: "outside", email: "outside@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
  const outside = fixture.t.withIdentity({ subject: "outside" });
  const invite = () => fixture.admin.action(api.evidenceLibraries.invitationActions.invite, { libraryId, email: "Outside@example.org", role: "creator" });
  return { ...fixture, libraryId, outside, invite };
}

describe("library invitations", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
    vi.stubEnv("EL_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("EL_SMTP_FROM", "libraries@example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    vi.stubEnv("CLERK_SECRET_KEY", "test-clerk-key");
    mail.sendMail.mockReset().mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: [{ email_address: "outside@example.org", verification: { status: "verified" } }] })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("accepts external access only after verified email confirmation without joining the organization", async () => {
    const fixture = await setup();
    await fixture.invite();
    const invitations = (await fixture.outside.query(api.evidenceLibraries.invitations.listInvitations, {})).page;
    expect(invitations).toEqual([expect.objectContaining({ libraryId: fixture.libraryId, role: "creator" })]);
    expect((await fixture.outside.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([]);
    await fixture.outside.action(api.evidenceLibraries.invitationActions.respond, { invitationId: invitations[0].invitationId, accept: true });
    // A second press of Accept, or a second tab's, changes nothing.
    await fixture.outside.action(api.evidenceLibraries.invitationActions.respond, { invitationId: invitations[0].invitationId, accept: true });
    expect((await fixture.outside.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([expect.objectContaining({ _id: fixture.libraryId, role: "creator" })]);
    expect(await fixture.t.run(ctx => ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", q => q.eq("clerkUserId", "outside").eq("state", "active")).collect())).toEqual([]);
    expect((await fixture.outside.query(api.evidenceLibraries.invitations.listInvitations, {})).page).toEqual([]);
    await fixture.t.run(async ctx => {
      const assignment = await ctx.db.query("itemAccess").withIndex("by_item_and_grantedAt", q => q.eq("item", fixture.libraryId)).unique();
      // Its role is a row of the table every shared item's guests are in, under the library's own kind.
      expect(assignment).toMatchObject({ kind: "library", role: "creator" });
      await ctx.db.delete("itemAccess", assignment!._id);
    });
    expect(mail.sendMail.mock.calls[0][0]).toMatchObject({ from: {name: "Climate Evidence", address: "libraries@example.test"}, to: "outside@example.org", text: expect.stringContaining("https://app.example.test/evidence-communities?from=shared") });
  });

  it("finds an invitation sent to another address Clerk verified on the account, and lets them answer it", async () => {
    const fixture = await setup();
    // Clerk says the account has two verified addresses; its own is the first.
    await fixture.t.mutation(internal.users.internal.upsertUserFromClerk, {
      clerkId: "second", email: "first@example.org", verifiedEmails: ["first@example.org", "second@example.org"],
      eventId: "evt_second", eventType: "user.created", instanceId: "ins_1", occurredAt: 1, payloadSha256: "e".repeat(64),
    });
    const second = fixture.t.withIdentity({ subject: "second" });
    await fixture.admin.action(api.evidenceLibraries.invitationActions.invite, { libraryId: fixture.libraryId, email: "Second@example.org", role: "editor" });
    const [invitation] = (await second.query(api.evidenceLibraries.invitations.listInvitations, {})).page;
    expect(invitation).toMatchObject({ libraryId: fixture.libraryId, role: "editor" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: [{ email_address: "first@example.org", verification: { status: "verified" } }, { email_address: "second@example.org", verification: { status: "verified" } }] })));
    await second.action(api.evidenceLibraries.invitationActions.respond, { invitationId: invitation.invitationId, accept: true });
    expect((await second.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([expect.objectContaining({ _id: fixture.libraryId, role: "editor" })]);
  });

  it.each(["expired", "cancelled", "disabled-library", "deleted-organization", "suspended-account"] as const)("does not list an %s invitation", async reason => {
    const fixture = await setup();
    await fixture.invite();
    const [invitation] = (await fixture.outside.query(api.evidenceLibraries.invitations.listInvitations, {})).page;
    await fixture.t.run(async ctx => {
      if (reason === "expired") await ctx.db.patch("itemInvitations", invitation.invitationId, { expiresAt: Date.now() - 1 });
      if (reason === "cancelled") await ctx.db.patch("itemInvitations", invitation.invitationId, { state: "cancelled" });
      if (reason === "disabled-library") await ctx.db.patch("evidenceLibraries", fixture.libraryId, { state: "disabled" });
      if (reason === "deleted-organization") {
        await ctx.db.patch("organizations", await organizationOfLibrary(ctx, fixture.libraryId), { state: "deleted" });
      }
      if (reason === "suspended-account") {
        const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", "outside")).unique();
        await ctx.db.patch("users", user!._id, { state: "suspended" });
      }
    });
    if (reason === "expired") await fixture.t.mutation(internal.sharing.invitations.expire, { invitationId: invitation.invitationId });
    expect((await fixture.outside.query(api.evidenceLibraries.invitations.listInvitations, {})).page).toEqual([]);
  });

  it("expires an invitation when its time is up, counting from the latest send", async () => {
    const fixture = await setup();
    vi.useFakeTimers();
    try {
      const listed = async () => ((await fixture.outside.query(api.evidenceLibraries.invitations.listInvitations, {})).page).length;
      const day = 86_400_000;
      await fixture.invite();
      vi.advanceTimersByTime(3 * day);
      await fixture.invite();
      // The first send's expiry runs at day 7 and leaves the re-sent invitation pending.
      vi.advanceTimersByTime(5 * day);
      await fixture.t.finishInProgressScheduledFunctions();
      expect(await listed()).toBe(1);
      vi.advanceTimersByTime(3 * day);
      await fixture.t.finishInProgressScheduledFunctions();
      expect(await listed()).toBe(0);
      const [invitation] = await fixture.t.run(ctx => ctx.db.query("itemInvitations").collect());
      expect(invitation.state).toBe("expired");
    } finally { vi.useRealTimers(); }
  });

  it("rejects an unverified email and a cancelled invitation", async () => {
    const fixture = await setup();
    await fixture.invite();
    const [invitation] = (await fixture.outside.query(api.evidenceLibraries.invitations.listInvitations, {})).page;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: [{ email_address: "outside@example.org", verification: { status: "unverified" } }] })));
    await expect(fixture.outside.action(api.evidenceLibraries.invitationActions.respond, { invitationId: invitation.invitationId, accept: true })).rejects.toThrow();
    await fixture.admin.mutation(api.evidenceLibraries.invitations.change, { invitationId: invitation.invitationId, cancel: true });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: [{ email_address: "outside@example.org", verification: { status: "verified" } }] })));
    await expect(fixture.outside.action(api.evidenceLibraries.invitationActions.respond, { invitationId: invitation.invitationId, accept: true })).rejects.toThrow();
    expect((await fixture.outside.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([]);
  });

  it("uses the library contact address and rejects a formatted platform sender", async () => {
    const fixture = await setup({contact: {email: "contact@climate.example"}});
    await fixture.invite();
    expect(mail.sendMail.mock.lastCall?.[0]).toMatchObject({from: {name: "Climate Evidence", address: "contact@climate.example"}, replyTo: "contact@climate.example"});
    vi.stubEnv("EL_SMTP_FROM", "Platform <mail@example.org>");
    await expect(fixture.invite()).rejects.toThrow("EL_SMTP_FROM must be a bare email address");
  });

  it("refuses invitations from a collaborator and records delivery failure for the Owner", async () => {
    const fixture = await setup();
    await expect(fixture.outside.action(api.evidenceLibraries.invitationActions.invite, { libraryId: fixture.libraryId, email: "someone@example.org", role: "editor" })).rejects.toThrow();
    mail.sendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));
    await expect(fixture.invite()).rejects.toThrow();
    const team = await fixture.admin.query(api.evidenceLibraries.queries.listTeam, { libraryId: fixture.libraryId });
    expect(team.invitations).toEqual([expect.objectContaining({ email: "outside@example.org", delivery: "failed" })]);
  });
});
